import { useCallback, useState } from 'react';
import {
  deriveIvBase64,
  deriveKeyBase64,
  encodeSyncPayload,
  encryptSyncPayload,
  isValidCode,
  isValidPin,
  parseWahlapQrPayload,
} from '@astramai/core';

import { SyncError, putSyncPayload } from '../sync/client';

/**
 * 同步面板 —— 方向是 **电脑 → 手表**。
 *
 * ── 为什么是这个方向 ────────────────────────────────────────────────
 *
 * 手表上没有好用的输入法。让人在表盘上敲 15 位好友码几乎不可能，
 * 所以：在电脑上填（键盘舒服），手表取走。
 *
 * ── 为什么配对码由手表生成 ──────────────────────────────────────────
 *
 * 如果网页生成码，手表就得**手输** 10 位数字 —— 那还是回到了
 * "在手表上打字"的老问题。
 *
 * 现在手表自己生成、自己显示，取回时一个键都不用按。
 * 网页这边只需要把码抄过来。
 *
 * ── 加密 ────────────────────────────────────────────────────────────
 *
 * 数据在浏览器里先加密再上传，服务器只拿到密文。
 * 密钥 = PIN + 配对码派生，服务器两个都不知道（码它知道，PIN 不知道）。
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
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [kind, setKind] = useState<PayloadKind>('friendCode');
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  /** 本地校验，别把明显错的东西加密后传上去。 */
  const validateValue = useCallback(
    (text: string): string | null => {
      if (!text) return `请填写${KIND_LABELS[kind]}。`;

      if (kind === 'qr') {
        const parsed = parseWahlapQrPayload(text);
        if (!parsed || !parsed.content) return '这段内容不像是舞萌玩家二维码。';
        return null;
      }

      if (!/^\d+$/.test(text)) return `${KIND_LABELS[kind]}只能是数字。`;
      if (kind === 'friendCode' && text.length !== 15) return '好友码应当是 15 位数字。';
      return null;
    },
    [kind],
  );

  const handleSend = useCallback(async () => {
    setFeedback(null);

    if (!isValidCode(code)) {
      setFeedback({ tone: 'error', text: '配对码是手表上显示的 6 位数字。' });
      return;
    }
    if (!isValidPin(pin)) {
      setFeedback({ tone: 'error', text: '密码是手表上显示的 4 位数字。' });
      return;
    }

    const problem = validateValue(value.trim());
    if (problem) {
      setFeedback({ tone: 'error', text: problem });
      return;
    }

    setSending(true);
    try {
      // 本地加密后再上传 —— 服务器永远看不到好友码
      const plaintext = encodeSyncPayload('astramai', { kind, value: value.trim() });
      const ciphertext = await encryptSyncPayload(
        plaintext,
        deriveKeyBase64(pin, code),
        deriveIvBase64(code),
      );

      await putSyncPayload(code, pin, ciphertext);

      setFeedback({
        tone: 'ok',
        text: '已加密送到服务器。现在回到手表点「取回数据」—— 数据 10 分钟后失效。',
      });
      setValue('');
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof SyncError ? error.message : '上传失败，检查网络后重试。',
      });
    } finally {
      setSending(false);
    }
  }, [code, kind, pin, validateValue, value]);

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div className="card__title">同步到手表</div>

      <p className="sync-lead">
        手表上没有好用的输入法，所以在电脑上填好，再由手表取走。
        数据在浏览器里先加密再上传，服务器只拿到密文。
      </p>

      <ol className="sync-steps">
        <li>在手表上打开「同步」，点「生成配对码」</li>
        <li>把手表显示的 6 位配对码和 4 位密码填到下面</li>
        <li>选好类型、填上数据，点「送到手表」</li>
        <li>回到手表点「取回数据」—— 会自动跳到查分页</li>
      </ol>

      <div className="field">
        <label htmlFor="sync-code">配对码</label>
        <input
          id="sync-code"
          className="input input--token"
          inputMode="numeric"
          autoComplete="off"
          placeholder="手表上显示的 6 位数字"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
        />
      </div>

      <div className="field">
        <label htmlFor="sync-pin">密码</label>
        <input
          id="sync-pin"
          className="input input--token"
          inputMode="numeric"
          autoComplete="off"
          placeholder="手表上显示的 4 位数字"
          maxLength={4}
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
        />
        <span className="field__hint">
          这个密码和配对码一起决定加密密钥。服务器不知道它，所以解不开你的数据。
        </span>
      </div>

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
        <label htmlFor="sync-value">{KIND_LABELS[kind]}</label>
        {kind === 'qr' ? (
          <textarea
            id="sync-value"
            className="input"
            rows={3}
            placeholder="粘贴玩家二维码解析出的文本"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        ) : (
          <input
            id="sync-value"
            className="input"
            inputMode="numeric"
            autoComplete="off"
            placeholder={KIND_HINTS[kind]}
            value={value}
            onChange={(event) => setValue(event.target.value.replace(/\D/g, ''))}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !sending) void handleSend();
            }}
          />
        )}
        <span className="field__hint">{KIND_HINTS[kind]}</span>
      </div>

      <button type="button" className="button" disabled={sending} onClick={() => void handleSend()}>
        {sending ? '加密上传中…' : '送到手表'}
      </button>

      {feedback ? (
        <p className={`sync-feedback sync-feedback--${feedback.tone}`}>{feedback.text}</p>
      ) : null}
    </section>
  );
}
