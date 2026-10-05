import { useState } from 'react';

import type { QueryKind } from '../api';

interface QueryBarProps {
  loading: boolean;
  onSubmit: (query: { kind: QueryKind; value: string }) => void;
  onDemo: () => void;
  initialKind?: QueryKind;
  initialValue?: string;
}

export function QueryBar({ loading, onSubmit, onDemo, initialKind = 'friendCode', initialValue = '' }: QueryBarProps) {
  const [kind, setKind] = useState<QueryKind>(initialKind);
  const [value, setValue] = useState(initialValue);

  const placeholder =
    kind === 'friendCode' ? '输入好友码，例如 123456789012345' : '输入已绑定落雪账号的 QQ 号';

  return (
    <form
      className="query"
      onSubmit={(event) => {
        event.preventDefault();
        if (!value.trim()) return;
        onSubmit({ kind, value: value.trim() });
      }}
    >
      <div className="segmented" role="group" aria-label="查询方式">
        <button type="button" aria-pressed={kind === 'friendCode'} onClick={() => setKind('friendCode')}>
          好友码
        </button>
        <button type="button" aria-pressed={kind === 'qq'} onClick={() => setKind('qq')}>
          QQ 号
        </button>
      </div>

      <label className="sr-only" htmlFor="query-value">
        {kind === 'friendCode' ? '好友码' : 'QQ 号'}
      </label>
      <input
        id="query-value"
        className="query__input"
        value={value}
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        onChange={(event) => setValue(event.target.value.replace(/[^\d]/g, ''))}
      />

      <button className="btn btn--primary" type="submit" disabled={loading || !value.trim()}>
        {loading ? <span className="spinner" aria-hidden /> : null}
        {loading ? '查询中' : '查询 B50'}
      </button>

      <button className="btn btn--ghost" type="button" onClick={onDemo} disabled={loading}>
        看演示数据
      </button>

      <p className="query__hint">
        数据来自落雪查分器；「看演示数据」使用内置模拟数据，无需开发者密钥。
      </p>
    </form>
  );
}
