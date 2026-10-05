/**
 * 一条命令把服务端部署（或更新）到目标服务器。
 *
 * 为什么不是「服务器上 npm ci && npm run build」：
 * 目标机只有 1676 MB 内存、通常不到 200 MB 空闲（上面跑着 MySQL、宝塔、
 * 雷池 WAF、QQ 机器人、frps），在上面跑一次前端构建很可能 OOM。
 * 所以改为**本地构建、只上传运行产物**，服务器上只做一次纯 COPY 的 docker build。
 *
 * 用法：
 *   node scripts/deploy-server.mjs            # 部署/更新
 *   node scripts/deploy-server.mjs --check    # 只看远端状态，不动任何东西
 *
 * 环境变量（都有默认值）：
 *   DEPLOY_HOST   目标 IP        默认 101.132.148.117
 *   DEPLOY_PORT   SSH 端口       默认 52778
 *   DEPLOY_USER   SSH 用户       默认 root
 *   DEPLOY_KEY    私钥路径       默认 ~/.ssh/astramai_ed25519
 *   DEPLOY_DIR    远端目录       默认 /www/wwwroot/astramai
 *
 * 关于密钥：**已存在的远端 .env 不会被覆盖**，避免每次部署都把 API_TOKEN 换掉、
 * 导致已经配好的客户端全部失效。要改配置请登服务器直接编辑那个文件。
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

const HOST = process.env.DEPLOY_HOST ?? '101.132.148.117';
const PORT = process.env.DEPLOY_PORT ?? '52778';
const USER = process.env.DEPLOY_USER ?? 'root';
const KEY = process.env.DEPLOY_KEY ?? resolve(process.env.USERPROFILE ?? process.env.HOME, '.ssh/astramai_ed25519');
const DIR = process.env.DEPLOY_DIR ?? '/www/wwwroot/astramai';
const TARGET = `${USER}@${HOST}`;

const root = resolve(import.meta.dirname, '..');
const checkOnly = process.argv.includes('--check');

const SSH_OPTS = ['-i', KEY, '-p', PORT, '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=20'];

/** 跑一条远端命令（脚本走 stdin，避免引号与编码问题）。 */
function remote(script, label) {
  process.stdout.write(`  ${label} … `);
  try {
    const out = execFileSync('ssh', [...SSH_OPTS, TARGET, 'bash -s'], {
      encoding: 'utf8',
      input: script.replace(/\r\n/g, '\n'),
      stdio: 'pipe',
    });
    console.log('OK');
    return out;
  } catch (error) {
    console.log('失败');
    const text = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    for (const line of String(text).split('\n').slice(-30)) if (line.trim()) console.log('      ' + line.trim());
    throw new Error(`远端步骤失败：${label}`);
  }
}

function scp(local, dest, label) {
  process.stdout.write(`  ${label} … `);
  execFileSync('scp', ['-i', KEY, '-P', PORT, '-o', 'StrictHostKeyChecking=no', local, `${TARGET}:${dest}`], {
    stdio: 'pipe',
  });
  console.log('OK');
}

// ── 只看状态 ────────────────────────────────────────────────────────────
if (checkOnly) {
  console.log(`检查 ${TARGET}:${DIR}\n`);
  console.log(
    remote(
      `set -uo pipefail
echo "--- container"
docker ps -a --filter name=astramai --format '  {{.Names}}  {{.Status}}  {{.Ports}}' || true
echo "--- health"
curl -s --max-time 8 http://127.0.0.1:8787/api/health || echo "  (unreachable)"
echo
echo "--- resources"
docker stats --no-stream --format '  mem={{.MemUsage}} cpu={{.CPUPerc}}' astramai 2>/dev/null || true
free -m | awk '/^Mem:/{printf "  host mem: free=%sMB avail=%sMB\\n",$4,$7}'
free -m | awk '/^Swap:/{printf "  host swap: free=%sMB\\n",$4}'
echo "--- restart policy"
docker inspect -f '  {{.HostConfig.RestartPolicy.Name}}' astramai 2>/dev/null || true
`,
      '远程检查',
    ),
  );
  process.exit(0);
}

// ── 1. 本地构建 ─────────────────────────────────────────────────────────
console.log('① 本地构建');
// npm-cli.js 在 Node 安装目录下，不在仓库里。
// 也不能直接 spawn `npm.cmd`：Node 20+ 在 Windows 上出于安全不允许，
// 会以 status:null 静默失败；而 shell:true 又会让 PowerShell 吞掉退出码。
const npmCli = resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
if (!existsSync(npmCli)) {
  console.error(`   找不到 npm CLI：${npmCli}`);
  process.exit(1);
}
execFileSync(process.execPath, [npmCli, 'run', 'build'], { cwd: root, stdio: 'pipe' });
console.log('   完成');

// ── 2. 组装最小运行目录 ─────────────────────────────────────────────────
console.log('\n② 组装最小运行目录');
const stage = mkdtempSync(resolve(tmpdir(), 'astramai-'));
const app = resolve(stage, 'app');
mkdirSync(app, { recursive: true });

for (const [from, to] of [
  ['apps/server/dist', 'apps/server/dist'],
  ['apps/server/package.json', 'apps/server/package.json'],
  ['apps/web/dist', 'apps/web/dist'],
]) {
  const src = resolve(root, from);
  if (!existsSync(src)) {
    console.error(`   ❌ 缺少 ${from}`);
    process.exit(1);
  }
  cpSync(src, resolve(app, to), { recursive: true });
}
// 真实副本而不是软链：Windows 的 junction 打进 tar 后在 Linux 上会失效
cpSync(resolve(root, 'packages/core'), resolve(app, 'node_modules/@astramai/core'), {
  recursive: true,
  filter: (src) => !src.includes('node_modules') && !src.endsWith('tsconfig.json'),
});
console.log('   完成（含 @astramai/core 真实副本）');

writeFileSync(
  resolve(app, 'Dockerfile'),
  `FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
COPY . /app
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \\
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/server/dist/index.js"]
`,
  'utf8',
);

const tarPath = resolve(stage, 'runtime.tar.gz');
execFileSync('tar', ['-czf', tarPath, '-C', app, '.'], { stdio: 'pipe' });
console.log(`   ${(statSync(tarPath).size / 1024).toFixed(1)} KB`);

// ── 3. 上传 ─────────────────────────────────────────────────────────────
console.log('\n③ 上传');
scp(tarPath, '/tmp/astramai-runtime.tar.gz', '运行包');

// ── 4. 远端部署 ─────────────────────────────────────────────────────────
console.log('\n④ 远端解包并重启');
const out = remote(
  `set -euo pipefail
DIR=${DIR}
mkdir -p "$DIR"

# .env 只在不存在时写入，避免覆盖掉已有的 API_TOKEN
if [ -f "$DIR/.env" ]; then
  echo "    .env 已存在，保留不动"
else
  echo "    !! 远端没有 .env，需要手工创建后再启动"
  exit 1
fi

tar -xzf /tmp/astramai-runtime.tar.gz -C "$DIR"
chmod 600 "$DIR/.env"

docker build -q -t astramai-server:latest "$DIR" >/dev/null
docker rm -f astramai >/dev/null 2>&1 || true
docker run -d --name astramai --restart unless-stopped \\
  --env-file "$DIR/.env" -e HOST=0.0.0.0 -e PORT=8787 \\
  -p 8787:8787 astramai-server:latest >/dev/null

ufw allow 8787/tcp >/dev/null 2>&1 || true

for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8787/api/health || true)
  [ "$code" = "200" ] && { echo "    健康检查通过（\${i}s）"; break; }
  sleep 1
done
docker ps --filter name=astramai --format '    {{.Names}}  {{.Status}}'
`,
  '部署',
);
console.log(out);

// ── 5. 清理与外部验证 ───────────────────────────────────────────────────
rmSync(stage, { recursive: true, force: true });

console.log('⑤ 从本机（外网）验证');
try {
  const res = execFileSync(
    'node',
    ['-e', `fetch('http://${HOST}:8787/api/health').then(r=>r.text()).then(t=>console.log(t)).catch(e=>{console.error('FAIL',e.message);process.exit(1)})`],
    { encoding: 'utf8', stdio: 'pipe', timeout: 20000 },
  );
  const parsed = JSON.parse(res);
  const d = parsed.data ?? {};
  console.log(`   外网可达 ✅  mode=${d.mode}  hasServerKey=${d.hasServerKey}  tokenRequired=${d.accessControl?.tokenRequired}`);
  if (d.accessControl?.tokenRequired !== true) {
    console.error('\n⚠️ tokenRequired 不是 true —— 立刻检查 API_TOKEN 是否生效！');
    process.exit(1);
  }
} catch (error) {
  console.log(`   ❌ 外网访问失败：${String(error.message).slice(0, 200)}`);
  console.log('   → 检查阿里云安全组是否放行 8787');
  process.exit(1);
}

void readFileSync;
console.log('\n✅ 部署完成');
