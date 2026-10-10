/**
 * 「同步到手表」。
 *
 * 手表上没有好用的输入法，让玩家在手表上敲好友码/QQ 号很难受。
 * 所以改成：手表显示一个 8 位配对码 → 在这里填数据 → 手表凭配对码取走。
 *
 * 关于安全：配对码只有 8 位十进制，所以服务端有失败次数限制；
 * 读取还要求带着设备密钥（只有手表有），传输密码是玩家可选的第二因素。
 */

import { parseWahlapQrPayload } from '@astramai/core';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, getPairState, isWellFormedToken, submitPair, type PairState } from '../api';

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

export function SyncToWatch() {
  const [token, setToken] = useState('');
  const [pin, setPin] = useState('');
  const [kind, setKind] = useState<PayloadKind>('friendCode');
  const [value, setValue] = useState('');
  const [state, setState] = useState<PairState | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);

  const tokenOk = isWellFormedToken(token);
  const pinRequired = state?.hasPin === true;

  // 配对码填够 8 位就去查一下这个码活没活、要不要密码。
  // 用 timer 而不是每敲一位就请求——但**本组件卸载时必须清掉**，
  // 否则返回上一页之后还会继续发请求。
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (!tokenOk) {
      setState(null);
      return undefined;
    }
    timer.current = window.setTimeout(() => {
      getPairState(token)
        .then((next) => {
          setState(next);
          if (!next.exists) setFeedback({ tone: 'error', text: '这个配对码不存在或已过期，请在手表上重新获取。' });
          else setFeedback(null);
        })
        .catch(() => setState(null));
    }, 350);

    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [token, tokenOk]);

  const handleSubmit = useCallback(async () => {
    setFeedback(null);

    if (!tokenOk) {
      setFeedback({ tone: 'error', text: '配对码是手表上显示的 8 位数字。' });
      return;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      setFeedback({ tone: 'error', text: `请填写${KIND_LABELS[kind]}。` });
      return;
    }

    // 按类型做一次本地校验，别把明显错的东西送到手表上
    if (kind === 'qr') {
      const parsed = parseWahlapQrPayload(trimmed);
      if (!parsed || !parsed.content) {
        setFeedback({ tone: 'error', text: '这段内容不像是舞萌玩家二维码。' });
        return;
      }
    } else if (!/^\d+$/.test(trimmed)) {
      setFeedback({ tone: 'error', text: `${KIND_LABELS[kind]}只能是数字。` });
      return;
    } else if (kind === 'friendCode' && trimmed.length !== 15) {
      setFeedback({ tone: 'error', text: '好友码应当是 15 位数字。' });
      return;
    }

    if (pinRequired && !/^\d{4,8}$/.test(pin)) {
      setFeedback({ tone: 'error', text: '这台设备已开启传输密码，请填写 4–8 位数字。' });
      return;
    }
    if (!pinRequired && pin && !/^\d{4,8}$/.test(pin)) {
      setFeedback({ tone: 'error', text: '传输密码要是 4–8 位数字。' });
      return;
    }

    setBusy(true);
    try {
      // 手表端拿到的是一个紧凑 JSON，自己解析后存本地
      const payload = JSON.stringify({ kind, value: trimmed });
      const result = await submitPair(token, payload, pin || undefined);
      if (result.ok) {
        setFeedback({
          tone: 'ok',
          text: result.pinSet
            ? '已送到服务器，并已为这台设备开启传输密码。请在手表上点「刷新」。'
            : '已送到服务器，请在手表上点「刷新」。数据会在手表取走后立刻删除，最多保留 10 分钟。',
        });
      } else {
        setFeedback({ tone: 'error', text: result.message ?? '提交失败。' });
      }
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof ApiError ? error.friendlyMessage : String(error),
      });
    } finally {
      setBusy(false);
    }
  }, [kind, pin, pinRequired, token, tokenOk, value]);

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div className="card__title">同步到手表</div>
      <p style={{ color: 'var(--text-dim)', fontSize: 13.5, marginTop: 0 }}>
        手表上没有好用的输入法，所以在电脑/手机上填好，再由手表取走。
      </p>

      <ol className="sync-steps">
        <li>在手表上打开「同步」，屏幕上会显示一个 8 位配对码</li>
        <li>把配对码填到下面，选好类型并填上数据</li>
        <li>点「同步到手表」，然后在手表上点「刷新」</li>
      </ol>

      <div className="field">
        <label htmlFor="sync-token">配对码</label>
        <input
          id="sync-token"
          className="input input--token"
          inputMode="numeric"
          autoComplete="off"
          placeholder="8 位数字"
          maxLength={8}
          value={token}
          onChange={(event) => setToken(event.target.value.replace(/\D/g, ''))}
        />
        {tokenOk && state?.exists ? (
          <span className="field__hint field__hint--ok">
            配对码有效
            {state.expiresAt ? `，${Math.max(0, Math.round((state.expiresAt - Date.now()) / 60000))} 分钟内有效` : ''}
          </span>
        ) : null}
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
              aria-current={kind === item ? 'true' : undefined}
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
          />
        )}
        <span className="field__hint">{KIND_HINTS[kind]}</span>
      </div>

      <div className="field">
        <label htmlFor="sync-pin">传输密码（可选）</label>
        <input
          id="sync-pin"
          className="input"
          inputMode="numeric"
          autoComplete="off"
          placeholder={pinRequired ? '这台设备已开启，必须填写' : '留空则不启用；填了即为这台设备开启 2FA'}
          maxLength={8}
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
        />
        <span className="field__hint">
          {pinRequired
            ? '这台设备之前设过传输密码，每次同步都要填对。'
            : '填上 4–8 位数字即可开启：以后只有知道密码的人才能往这台手表推数据。密码存在服务端（只存哈希），手表不需要输入。'}
        </span>
      </div>

      <button className="btn" type="button" disabled={busy || !tokenOk} onClick={() => void handleSubmit()}>
        {busy ? '正在同步…' : '同步到手表'}
      </button>

      {feedback ? (
        <div className={`alert alert--${feedback.tone === 'ok' ? 'ok' : feedback.tone === 'error' ? 'error' : 'info'}`} style={{ marginTop: 12 }}>
          <div>{feedback.text}</div>
        </div>
      ) : null}

      <p className="footnote" style={{ marginTop: 14 }}>
        数据只放在服务端内存里，不落盘、取走即删、最多保留 10 分钟。
        读取还需要手表本地的设备密钥——**即使有人猜中配对码，也读不走你的数据**。
      </p>
    </section>
  );
}
