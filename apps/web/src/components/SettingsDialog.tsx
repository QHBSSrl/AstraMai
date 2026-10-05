import { useEffect, useState } from 'react';

interface SettingsDialogProps {
  open: boolean;
  initialKey: string;
  hasServerKey: boolean;
  allowClientKey: boolean;
  onSave: (key: string) => void;
  onClose: () => void;
}

/**
 * 设置弹层：临时填入落雪开发者密钥。
 *
 * 密钥只存在 sessionStorage（关掉标签页即失效），并且只发给本机服务端转发，
 * 服务端不落盘、不记录。生产环境应把 ALLOW_CLIENT_KEY 设为 false，
 * 改用服务端 .env 持有密钥。
 */
export function SettingsDialog({
  open,
  initialKey,
  hasServerKey,
  allowClientKey,
  onSave,
  onClose,
}: SettingsDialogProps) {
  const [value, setValue] = useState(initialKey);

  useEffect(() => {
    if (open) setValue(initialKey);
  }, [open, initialKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="设置"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="card modal">
        <h3>开发者密钥</h3>
        <p>
          落雪「开发者 API」密钥，申请入口：{' '}
          <a href="https://maimai.lxns.net/developer/apply" target="_blank" rel="noreferrer">
            开发者面板
          </a>
          。需要至少具备 <code>allow_third_party_fetch_player</code> 与{' '}
          <code>allow_third_party_fetch_scores</code> 权限才能查 B50。
        </p>

        {hasServerKey ? (
          <p className="badge badge--live" style={{ display: 'inline-flex' }}>
            服务端已配置密钥，这里的填写会覆盖它
          </p>
        ) : null}

        {!allowClientKey ? (
          <p className="badge badge--warn" style={{ display: 'inline-flex' }}>
            服务端已禁止页面填密钥（ALLOW_CLIENT_KEY=false）
          </p>
        ) : null}

        <div className="modal__field">
          <label htmlFor="dev-key">密钥</label>
          <input
            id="dev-key"
            type="password"
            value={value}
            spellCheck={false}
            autoComplete="off"
            placeholder="例如 9sKKK47Ewi20OroB8mhr_0zOiHO3n7jwTaU9atcf2dc="
            onChange={(event) => setValue(event.target.value)}
          />
        </div>

        <ul className="tips">
          <li>只保存在当前标签页的 sessionStorage，关闭标签页即失效。</li>
          <li>只发送给本机服务端（127.0.0.1）用于转发给落雪，不会被写入磁盘或日志。</li>
          <li>长期使用请改为在仓库根目录 .env 中设置 LXNS_API_KEY，并关闭页面填写。</li>
        </ul>

        <div className="modal__actions">
          <button
            className="btn btn--ghost"
            type="button"
            onClick={() => {
              onSave('');
              onClose();
            }}
          >
            清除
          </button>
          <button
            className="btn btn--primary"
            type="button"
            onClick={() => {
              onSave(value.trim());
              onClose();
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
