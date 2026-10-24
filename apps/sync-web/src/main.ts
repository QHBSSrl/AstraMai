/**
 * 同步到手表 —— 独立的 Cloudflare Pages 页面。
 *
 * ── 为什么要单独一页 ────────────────────────────────────────────────
 *
 * 整个 AstraMai 网页背后是那台阿里云服务器（大陆 35ms，基础体验好）。
 * 但**同步**这条链路我们决定全放在 Cloudflare 上（Workers + KV + Pages），
 * 理由是不想为了一个 10 分钟有效期的配对码把数据经手自家服务器。
 *
 * 所以这个页面**只和 Worker 打交道**，不碰 B50 API ——
 * 也就不存在跨域、也不需要那台服务器配合。
 *
 * ── 和主站的关系 ────────────────────────────────────────────────────
 *
 * 主站（apps/web）里也有一个同步面板，走的是同一套 core 函数。
 * 两边都能用；这个页面是给"只想同步、不想开主站"的场景准备的。
 */

import {
  deriveIvBase64,
  deriveKeyBase64,
  encodeSyncPayload,
  encryptSyncPayload,
  isValidCode,
  isValidPin,
  parseWahlapQrPayload,
} from '@astramai/core';

import './style.css';

/** Workers 的地址。 */
const SYNC_BASE = 'https://worksync.astramai.astranexus.cn';

type PayloadKind = 'friendCode' | 'qq' | 'qr';

const KIND_LABELS: Record<PayloadKind, string> = {
  friendCode: '好友码',
  qq: 'QQ 号',
  qr: '玩家二维码',
};

const KIND_HINTS: Record<PayloadKind, string> = {
  friendCode: '15 位数字，游戏内「好友」页面可以看到',
  qq: '已绑定落雪的 QQ 号',
  qr: '把舞萌玩家二维码的文本内容粘贴进来',
};

/** Worker 的错误码 → 人话。 */
function describeError(code: string, status: number): string {
  switch (code) {
    case 'pin_mismatch':
      return '密码不对，或者这组号码已经过期。';
    case 'not_found':
      return '配对码不存在或已过期，回手表重新生成一个。';
    case 'not_uploaded':
      return '手表还没生成配对码，或者生成后超过 10 分钟了。';
    case 'expired':
      return '已过期，回手表重新生成配对码。';
    case 'too_large':
      return '数据太大，超过 256 KB。';
    case 'rate_limited':
      return '请求太频繁，等一分钟再试。';
    case 'invalid_pin':
      return '密码格式不对（4 位数字）。';
    case 'network':
      return '连不上同步服务，检查网络。';
    default:
      return `同步服务出错（${code || status}）`;
  }
}

async function putSyncPayload(code: string, pin: string, payload: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${SYNC_BASE}/sync/${code}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin, payload }),
    });
  } catch {
    throw new Error(describeError('network', 0));
  }

  const body = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!response.ok || body?.ok !== true) {
    throw new Error(describeError(body?.error ?? 'unknown', response.status));
  }
}

// ══════════════════════════════════════════════════════════════════════
// 界面
// ══════════════════════════════════════════════════════════════════════

const app = document.getElementById('app');
if (!app) throw new Error('缺少 #app 容器');

app.innerHTML = `
  <main class="card">
    <h1>同步到手表</h1>
    <p class="lead">
      手表上没有好用的输入法，所以在电脑上填好，再由手表取走。
      数据在浏览器里先加密再上传，服务器只拿到密文。
    </p>

    <ol class="steps">
      <li>在手表上打开「设置 → 同步到手表」，点「生成配对码」</li>
      <li>把手表显示的 6 位配对码和 4 位密码填到下面</li>
      <li>选好类型、填上数据，点「送到手表」</li>
      <li>回到手表点「取回数据」—— 会自动跳到查分页</li>
    </ol>

    <label class="field">
      <span>配对码</span>
      <input id="code" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="手表上显示的 6 位数字" />
    </label>

    <label class="field">
      <span>密码</span>
      <input id="pin" inputmode="numeric" autocomplete="off" maxlength="4" placeholder="手表上显示的 4 位数字" />
      <small>这个密码和配对码一起决定加密密钥。服务器不知道它，所以解不开你的数据。</small>
    </label>

    <div class="field">
      <span>数据类型</span>
      <div class="segmented" id="kinds"></div>
    </div>

    <label class="field">
      <span id="value-label">好友码</span>
      <input id="value" inputmode="numeric" autocomplete="off" />
      <small id="value-hint"></small>
    </label>

    <button id="submit" type="button">送到手表</button>
    <p id="feedback" class="feedback" hidden></p>
  </main>
`;

const $ = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`缺少 #${id}`);
  return node as T;
};

const codeInput = $<HTMLInputElement>('code');
const pinInput = $<HTMLInputElement>('pin');
const valueInput = $<HTMLInputElement>('value');
const valueLabel = $<HTMLSpanElement>('value-label');
const valueHint = $<HTMLElement>('value-hint');
const submitButton = $<HTMLButtonElement>('submit');
const feedback = $<HTMLParagraphElement>('feedback');
const kindsBox = $<HTMLDivElement>('kinds');

let kind: PayloadKind = 'friendCode';

/** 只保留数字（二维码类型除外）。 */
function digitsOnly(input: HTMLInputElement) {
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '');
  });
}
digitsOnly(codeInput);
digitsOnly(pinInput);

// 数据类型切换
const kindButtons = new Map<PayloadKind, HTMLButtonElement>();
for (const key of Object.keys(KIND_LABELS) as PayloadKind[]) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = KIND_LABELS[key];
  button.addEventListener('click', () => {
    kind = key;
    valueInput.value = '';
    syncKindUi();
  });
  kindButtons.set(key, button);
  kindsBox.appendChild(button);
}

function syncKindUi() {
  for (const [key, button] of kindButtons) {
    button.setAttribute('aria-checked', String(key === kind));
    button.className = key === kind ? 'on' : '';
  }
  valueLabel.textContent = KIND_LABELS[kind];
  valueHint.textContent = KIND_HINTS[kind];
  valueInput.inputMode = kind === 'qr' ? 'text' : 'numeric';
  valueInput.placeholder = KIND_HINTS[kind];
}

function showFeedback(tone: 'ok' | 'error', text: string) {
  feedback.hidden = false;
  feedback.className = `feedback ${tone}`;
  feedback.textContent = text;
}

function clearFeedback() {
  feedback.hidden = true;
  feedback.textContent = '';
}

/** 本地校验，别把明显错的加密后传上去。 */
function validateValue(text: string): string | null {
  if (!text) return `请填写${KIND_LABELS[kind]}。`;

  if (kind === 'qr') {
    const parsed = parseWahlapQrPayload(text);
    if (!parsed || !parsed.content) return '这段内容不像是舞萌玩家二维码。';
    return null;
  }

  if (!/^\d+$/.test(text)) return `${KIND_LABELS[kind]}只能是数字。`;
  if (kind === 'friendCode' && text.length !== 15) return '好友码应当是 15 位数字。';
  return null;
}

submitButton.addEventListener('click', () => {
  void (async () => {
    clearFeedback();

    const code = codeInput.value.trim();
    const pin = pinInput.value.trim();

    if (!isValidCode(code)) {
      showFeedback('error', '配对码是手表上显示的 6 位数字。');
      return;
    }
    if (!isValidPin(pin)) {
      showFeedback('error', '密码是手表上显示的 4 位数字。');
      return;
    }

    const value = valueInput.value.trim();
    const problem = validateValue(value);
    if (problem) {
      showFeedback('error', problem);
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = '加密上传中…';

    try {
      // 本地加密后再上传 —— 服务器永远看不到好友码
      const plaintext = encodeSyncPayload('astramai', { kind, value });
      const ciphertext = await encryptSyncPayload(
        plaintext,
        deriveKeyBase64(pin, code),
        deriveIvBase64(code),
      );

      await putSyncPayload(code, pin, ciphertext);

      showFeedback('ok', '已加密送到手表。现在回手表点「取回数据」—— 10 分钟后失效。');
      valueInput.value = '';
    } catch (error) {
      showFeedback('error', error instanceof Error ? error.message : '上传失败。');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = '送到手表';
    }
  })();
});

syncKindUi();
