/**
 * 版本检查与升级提醒。
 *
 * ── 为什么需要 ──────────────────────────────────────────────────────
 *
 * 服务端从阿里云搬到了机房，`DEFAULT_SERVER_BASE` 也跟着换了域名。
 * **旧版 App 里写死的还是老地址**，一旦旧机器下线，那些人就打不开查分了。
 *
 * 所以要在 App 里主动提示升级，而不是等用户自己发现。
 *
 * ── 数据从哪来 ──────────────────────────────────────────────────────
 *
 * 不在服务端里存版本号，而是读 R2 上的 `latest.json` —— 那份文件
 * 官网和客户端共用，发版时只改一处。
 *
 * ── 三条约束（和 diag.js 一致）──────────────────────────────────────
 *
 *   1. 绝不抛异常：查版本失败不能影响正常使用
 *   2. 不阻塞：检查是异步的，界面先出来
 *   3. 同一版本只提示一次：把「提示过」记在本地，别每次开都弹
 */

import { getServerBase } from './config.js';

/** 发版清单。改了发版流程要同步这里。 */
const MANIFEST_URL = 'https://orhythm-dl.astranexus.cn/latest.json';

/** 记录「已经提示过哪个版本」，避免重复弹。 */
const SEEN_KEY = 'updateSeenVersion';

let fetchModule;

function getFetch() {
  if (fetchModule !== undefined) return fetchModule;
  try {
    // eslint-disable-next-line global-require
    const mod = require('@system.fetch') || null;
    fetchModule = typeof mod === 'function' ? mod : mod && mod.default;
  } catch (error) {
    fetchModule = null;
  }
  return fetchModule;
}

/**
 * 比较两个版本号。
 *
 * 只处理 `x.y.z` 这种简单格式 —— 我们的版本号就是这个形状，
 * 不需要语义化版本的完整规则（也不该为此引依赖）。
 *
 * @returns {number} a>b 返回 1，相等 0，a<b 返回 -1
 */
export function compareVersion(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** 当前 App 的版本号。没打包进常量就从 manifest 里读不到，所以在这里写死。 */
export const CURRENT_VERSION = '0.1.4';

/**
 * 查一次有没有新版本。
 *
 * 回调风格而不是 Promise —— Vela 的 fetch 是回调式的，
 * 包一层 Promise 反而多一处可能出错的地方。
 *
 * @param {(info: {hasUpdate: boolean, latest: string, current: string, highlight: string}) => void} done
 */
export function checkUpdate(done) {
  const current = CURRENT_VERSION;

  // 服务端地址都配不出来，就别查版本了
  if (!getServerBase()) {
    done && done({ hasUpdate: false, latest: current, current, highlight: '' });
    return;
  }

  const doFetch = getFetch();
  if (typeof doFetch !== 'function') {
    done && done({ hasUpdate: false, latest: current, current, highlight: '' });
    return;
  }

  try {
    doFetch({
      url: MANIFEST_URL,
      method: 'GET',
      header: { 'Cache-Control': 'no-cache' },
      success: (res) => {
        try {
          let body = res && res.data !== undefined ? res.data : '';
          if (typeof body !== 'string') body = JSON.stringify(body);
          const data = JSON.parse(body || '{}');
          const latest = String(data.version || current).replace(/^v/i, '');
          const result = {
            hasUpdate: compareVersion(latest, current) > 0,
            latest,
            current,
            highlight: String(data.highlight || data.changelogSummary || ''),
          };
          if (done) done(result);
        } catch (error) {
          if (done) done({ hasUpdate: false, latest: current, current, highlight: '' });
        }
      },
      fail: () => {
        if (done) done({ hasUpdate: false, latest: current, current, highlight: '' });
      },
    });
  } catch (error) {
    if (done) done({ hasUpdate: false, latest: current, current, highlight: '' });
  }
}

/**
 * 弹一次升级提醒（同一版本只弹一次）。
 *
 * @param {object} prompt  `@system.prompt` 模块
 * @param {object} store   `./store.js`
 */
export function remindIfNeeded(prompt, store) {
  checkUpdate((info) => {
    try {
      if (!info.hasUpdate) return;

      // 这个版本已经提示过就不弹了，免得每次开都烦人
      let seen = '';
      try {
        seen = store.readSetting(SEEN_KEY, '') || '';
      } catch (error) {
        seen = '';
      }
      if (seen === info.latest) return;

      if (prompt && typeof prompt.showToast === 'function') {
        /*
         * 只说一句，不打断操作。
         *
         * 手表屏幕小，弹对话框会挡住内容 —— toast 更合适，
         * 想看详情的人自己会去 设置 → 关于。
         */
        prompt.showToast({
          message: `可更新 v${info.latest}，见 设置-关于`,
          duration: 4000,
        });
      }

      try {
        store.writeSetting(SEEN_KEY, info.latest);
      } catch (error) {
        // 记不住就记不住，下次再弹
      }
    } catch (error) {
      // 提示自己出错就算了
    }
  });
}
