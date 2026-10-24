import { useCallback, useRef, useState } from 'react';
import {
  deriveIvBase64,
  deriveKeyBase64,
  decodeSyncPayload,
  decryptSyncPayload,
  encodeSyncPayload,
  encryptSyncPayload,
  isValidCode,
  isValidPin,
  parseWahlapQrPayload,
} from '@astramai/core';

import { SyncError, createSyncCode, getSyncPayload, putSyncPayload } from '../sync/client';

/**
 * 同步面板（方案 B：Cloudflare Workers + 端到端加密）。
 *
 * ── 和旧的 SyncToWatch 的区别 ────────────────────────────────────────
 *
 * 旧的是打主服务器（`/api/pair/*`），那台是**裸 IP + HTTP** ——
 * 设备密钥和好友码明文过网。现在换成 Cloudflare 的 HTTPS，
 * 而且数据在浏览器里**先加密**再上传，服务器只拿到密文。
 *
 * ── 两个方向 ────────────────────────────────────────────────────────
 *
 * 「送到手表」：手表上没有好输入法，所以在电脑上填好友码 → 手表取走。
 * 「从手表取」：手表查完 B50，想在大屏幕上看 → 这边拉下来。
 *
 * ── 为什么手表要输 10 位（6 位码 + 4 位 PIN）────────────────────────
 *
 * 旧方案手表只要输 8 位码，因为设备密钥是手表自己生成的、不用人记。
 * 新方案没有设备密钥绑定，所以 PIN 成了必输项。
 *
 * 多这 2 位换来的是：HTTPS、服务器只存密文、KV 不占那台 2 核服务器的内存。
 * 值的。
 */

/** 同步过去的数据类型。 */
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

interface Feedback {
  tone: 'ok' | 'error' | 'info';
  text: string;
}

export function SyncPanel() {
  // ── 「送到手表」────��────────────────────────────────────────────────
  const [kind, setKind] = useState<PayloadKind>('friendCode');
  const [value, setValue] = useState('');
  const [pin, setPin] = useState('');
  const [issued, setIssued] = useState<{ code: string; pin: string; expiresAt: number } | null>(null);
  const [sending, setSending] = useState(false);
  const [sendFeedback, setSendFeedback] = useState<Feedback | null>(null);

  // ── 「从手表取」──────────────────────────────────────────────────────
  const [pullCode, setPullCode] = useState('');
  const [pullPin, setPullPin] = useState('');
  const [pulling, setPulling] = useState(false);
  const [pullFeedback, setPullFeedback] = useState<Feedback | null>(null);
  const [pulled, setPulled] = useState<{ game: string; createdAt: string; summary: string } | null>(null);

  const pinInput = useRef<HTMLInputElement | null>(null);

  /** 本地校验输入，别把明显错的东西加密后传上去。 */
  const validateValue = useCallback((text: string): string | null => {
    if (!text) return `请填写${KIND_LABELS[kind]}。`;

    if (kind === 'qr') {
      const parsed = parseWahlapQrPayload(text);
      if (!parsed || !parsed.content) return '这段内容不像是舞萌玩家二维码。';
      return null;
    }

    if (!/^\d+$/.test(text)) return `${KIND_LABELS[kind]}只能是数字。`;
    if (kind === 'friendCode' && text.length !== 15) return '好友码应当是 15 位数字。';
    return null;
  }, [kind]);

  // ── 送到手表 ────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    setSendFeedback(null);

    const problem = validateValue(value.trim());
    if (problem) {
      setSendFeedback({ tone: 'error', text: problem });
      return;
    }
    if (!isValidPin(pin)) {
      setSendFeedback({ tone: 'error', text: '传输密码要 4 位数字。' });
      return;
    }

    setSending(true);
    try {
      // 1. 先在本地加密，再上传 —— 服务器永远看不到好友码
      const created = await createSyncCode(pin);
      const code = created.code;

      const plaintext = encodeSyncPayload('astramai', { kind, value: value.trim() });
      const ciphertext = await encryptSyncPayload(
        plaintext,
        deriveKeyBase64(pin, code),
        deriveIvBase64(code),
      );

      await putSyncPayload(code, pin, ciphertext);

      setIssued({ code, pin, expiresAt: created.expiresAt });
      setSendFeedback({
        tone: 'ok',
        text: '已加密上传。现在到手表上打开「同步」，输入下面这组号码。',
      });
      setValue('');
    } catch (error) {
      setSendFeedback({ tone: 'error', text: describe(error) });
    } finally {
      setSending(false);
    }
  }, [pin, validateValue, value]);

  // ── 从手表取 ────────────────────────────────────────────────────────
  const handlePull = useCallback(async () => {
    setPullFeedback(null);
    setPulled(null);

    if (!isValidCode(pullCode)) {
      setPullFeedback({ tone: 'error', text: '配对码是手表上显示的 6 位数字。' });
      return;
    }
    if (!isValidPin(pullPin)) {
      setPullFeedback({ tone: 'error', text: '传输密码是 4 位数字。' });
      return;
    }

    setPulling(true);
    try {
      const fetched = await getSyncPayload(pullCode, pullPin);

      // 解密失败会抛异常 —— 不吞掉，否则"输错密码"和"数据坏了"看起来一样
      const plaintext = await decryptSyncPayload(
        fetched.payload,
        deriveKeyBase64(pullPin, pullCode),
        deriveIvBase64(pullCode),
      );
      const decoded = decodeSyncPayload(plaintext);

      setPulled({
        game: decoded.game,
        createdAt: decoded.createdAt,
        summary: summarize(decoded.view),
      });
      setPullFeedback({ tone: 'ok', text: '已取到数据并解密成功。' });
    } catch (error) {
      // 解密失败（DOMException）和业务错误分开说
      if (error instanceof SyncError) {
        setPullFeedback({ tone: 'error', text: error.message });
      } else {
        setPullFeedback({
          tone: 'error',
          text: '解密失败。多半是传输密码输错了 —— 也可能是那组数据已经过期。',
        });
      }
    } finally {
      setPulling(false);
    }
  }, [pullCode, pullPin]);

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div className="card__title">同步</div>
      <p style={{ color: 'var(--text-dim)', fontSize: 13.5, marginTop: 0 }}>
        数据在浏览器里先加密再上传，服务器只拿到密文。配对码 10 分钟后失效。
      </p>

      {/* ── 送到手表 ── */}
      <div className="sync-block">
        <h4 className="sync-block__title">送到手表</h4>
        <p className="sync-block__hint">
          手表上没有好用的输入法，所以在电脑上填好，再由手表取走。
        </p>

        <div className="field">
          <label>数据类型</label>
          <div className="segmented" role="radiogroup" aria-label="数据类型">
            {(Object.keys(KIND_LABELS) as PayloadKind[]).map((item) => (
              <button
                key={item}
                type="button"
                role="radio"
                aria-checked={kind === item}
                onClick={() => {
                  setKind(item);
                  setValue('');
                }}
              >
                {KIND_LABELS[item]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="send-value">{KIND_LABELS[kind]}</label>
          {kind === 'qr' ? (
            <textarea
              id="send-value"
              className="input"
              rows={3}
              placeholder="粘贴玩家二维码解析出的文本"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          ) : (
            <input
              id="send-value"
              className="input"
              inputMode="numeric"
              autoComplete="off"
              placeholder={KIND_HINTS[kind]}
              value={value}
              onChange={(event) => setValue(event.target.value.replace(/\D/g, ''))}
            />
          )}
        </div>

        <div className="field">
          <label htmlFor="send-pin">传输密码</label>
          <input
            id="send-pin"
            className="input input--token"
            inputMode="numeric"
            autoComplete="off"
            placeholder="4 位数字，待会儿要在手表上输"
            maxLength={4}
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !sending) void handleSend();
            }}
          />
          <span className="field__hint">
            这个密码和配对码一起决定加密密钥。服务器不知道它，所以解不开你的数据。
          </span>
        </div>

        <button type="button" className="button" disabled={sending} onClick={() => void handleSend()}>
          {sending ? '加密上传中…' : '加密并上传'}
        </button>

        {sendFeedback ? (
          <p className={`sync-feedback sync-feedback--${sendFeedback.tone}`}>{sendFeedback.text}</p>
        ) : null}

        {issued ? (
          <div className="sync-issued">
            <div className="sync-issued__row">
              <span className="sync-issued__label">配对码</span>
              <strong className="sync-issued__value">{issued.code}</strong>
            </div>
            <div className="sync-issued__row">
              <span className="sync-issued__label">传输密码</span>
              <strong className="sync-issued__value">{issued.pin}</strong>
            </div>
            <div className="sync-issued__ttl">
              {Math.max(0, Math.round((issued.expiresAt * 1000 - Date.now()) / 60000))} 分钟内有效
            </div>
          </div>
        ) : null}
      </div>

      {/* ── 从手表取 ── */}
      <div className="sync-block">
        <h4 className="sync-block__title">从手表取</h4>
        <p className="sync-block__hint">
          手表上查完成绩后，输入它显示的配对码和密码，把数据拉下来。
        </p>

        <div className="field">
          <label htmlFor="pull-code">配对码</label>
          <input
            id="pull-code"
            className="input input--token"
            inputMode="numeric"
            autoComplete="off"
            placeholder="6 位数字"
            maxLength={6}
            value={pullCode}
            onChange={(event) => setPullCode(event.target.value.replace(/\D/g, ''))}
          />
        </div>

        <div className="field">
          <label htmlFor="pull-pin">传输密码</label>
          <input
            id="pull-pin"
            ref={pinInput}
            className="input input--token"
            inputMode="numeric"
            autoComplete="off"
            placeholder="4 位数字"
            maxLength={4}
            value={pullPin}
            onChange={(event) => setPullPin(event.target.value.replace(/\D/g, ''))}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !pulling) void handlePull();
            }}
          />
        </div>

        <button type="button" className="button" disabled={pulling} onClick={() => void handlePull()}>
          {pulling ? '拉取中…' : '拉取并解密'}
        </button>

        {pullFeedback ? (
          <p className={`sync-feedback sync-feedback--${pullFeedback.tone}`}>{pullFeedback.text}</p>
        ) : null}

        {pulled ? (
          <div className="sync-pulled">
            <div className="sync-pulled__row">
              <span>游戏</span>
              <b>{pulled.game}</b>
            </div>
            <div className="sync-pulled__row">
              <span>同步于</span>
              <b>{new Date(pulled.createdAt).toLocaleString()}</b>
            </div>
            <div className="sync-pulled__row">
              <span>内容</span>
              <b>{pulled.summary}</b>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** 把异常翻成人话。 */
function describe(error: unknown): string {
  if (error instanceof SyncError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

/**
 * 给载荷生成一句摘要。
 *
 * 只做"能看出这坨数据是什么"的程度 —— 不解析具体字段，
 * 因为载荷可能是任何一种数据（好友码 / B50 视图）。
 */
function summarize(view: unknown): string {
  if (!view || typeof view !== 'object') return '（空）';

  const record = view as Record<string, unknown>;
  if (typeof record.kind === 'string' && typeof record.value === 'string') {
    return `${record.kind}：${record.value}`;
  }

  // B50 视图：说出有多少条成绩，比丢一坨 JSON 好
  const standard = Array.isArray(record.standard) ? record.standard.length : null;
  const dx = Array.isArray(record.dx) ? record.dx.length : null;
  if (standard !== null || dx !== null) {
    return `Best 50（旧曲 ${standard ?? 0} 首 / 新曲 ${dx ?? 0} 首）`;
  }

  return '自定义数据';
}
