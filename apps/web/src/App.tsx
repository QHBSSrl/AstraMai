import type { B50Diff, B50Entry, B50View } from '@astramai/core';
import {
  diffB50,
  FC_LABELS,
  FS_LABELS,
  formatAchievement,
  formatInt,
  formatLevelValue,
  formatRelative,
} from '@astramai/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ApiError,
  getHealth,
  queryB50,
  readStoredKey,
  writeStoredKey,
  type HealthInfo,
  type QueryKind,
} from './api';
import { PlayerCard } from './components/PlayerCard';
import { QrStudio } from './components/QrStudio';
import { QueryBar } from './components/QueryBar';
import { ScoreDetail } from './components/ScoreDetail';
import { B50DiffPanel } from './components/B50DiffPanel';
import { PushPlanner } from './components/PushPlanner';
import { readPreviousView, writePreviousView } from './diff-store';
import { ScoreTable, entryKey } from './components/ScoreTable';
import { SelfCheckPanel } from './components/SelfCheckPanel';
import { SettingsDialog } from './components/SettingsDialog';
import { StatsPanel } from './components/StatsPanel';
import { SyncToWatch } from './components/SyncToWatch';

/** 演示模式使用的固定好友码——Mock 模式下任何数字都能出数据。 */
const DEMO_FRIEND_CODE = '888888888888888';

type Tab = 'mix' | 'standard' | 'dx' | 'selections';

/** 顶层页面。B50 查分、二维码工作台、同步到手表各自独立，互不干扰对方的状态。 */
type Page = 'b50' | 'qr' | 'sync' | 'push';

interface Result {
  view: B50View;
  mode: 'live' | 'mock';
  usedServerKey: boolean;
  librarySource: string;
  elapsedMs: number;
}

export function App() {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [devKey, setDevKey] = useState(() => readStoredKey());
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  /** 这次和上次的对比。null 表示没有可比的上一次。 */
  const [diff, setDiff] = useState<B50Diff | null>(null);

  const [tab, setTab] = useState<Tab>('mix');
  const [page, setPage] = useState<Page>('b50');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [query, setQuery] = useState<{ kind: QueryKind; value: string }>({
    kind: 'friendCode',
    value: '',
  });
  const [lastQuery, setLastQuery] = useState<{ kind: QueryKind; value: string; mock: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const bootstrapped = useRef(false);

  // ── 健康检查 ──────────────────────────────────────────────────────────
  const refreshHealth = useCallback(async () => {
    try {
      const response = await getHealth();
      setHealth(response.data);
      setHealthError(null);
    } catch (err) {
      setHealth(null);
      setHealthError(err instanceof ApiError ? err.friendlyMessage : String(err));
    }
  }, []);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth, devKey]);

  // ── 查询 ──────────────────────────────────────────────────────────────
  const runQuery = useCallback(
    async (kind: QueryKind, value: string, mock: boolean) => {
      setLoading(true);
      setError(null);
      setSelectedKey(null);
      try {
        const response = await queryB50({ kind, value, ...(mock ? { mock: true } : {}) });
        const view = response.data;

        /*
         * 对比：**先读旧的 → 算 → 再存新的**。
         *
         * 顺序反了就是拿新数据和新数据比，永远"没有变化"。
         * （手表端踩过一次，这里照抄那条注释。）
         *
         * mock 数据不参与对比 —— 拿模拟数据和真实数据比出来的差值是假的。
         */
        if (!mock) {
          try {
            const previous = readPreviousView();
            setDiff(diffB50(previous, view));
            writePreviousView(view);
          } catch (err) {
            // 对比失败绝不能让查询失败
            console.warn('[AstraMai] 成绩对比失败：', err);
            setDiff(null);
          }
        } else {
          setDiff(null);
        }

        setResult({
          view,
          mode: response.mode ?? 'live',
          usedServerKey: response.usedServerKey ?? true,
          librarySource: response.librarySource ?? 'lxns',
          elapsedMs: response.elapsedMs ?? 0,
        });
        setLastQuery({ kind, value, mock });
        // 查询成功顺手刷新一次健康信息（曲库缓存状态会变）
        void refreshHealth();
      } catch (err) {
        setResult(null);
        // 查询失败就清掉对比 —— 否则会残留上一次查询的对比结果，
        // 配着"查询失败"的空白页面很误导
        setDiff(null);
        setError(err instanceof ApiError ? err : new ApiError({ kind: 'unknown', message: String(err) }));
      } finally {
        setLoading(false);
      }
    },
    [refreshHealth],
  );

  // ── hash 路由：刷新后仍保留查询 ────────────────────────────────────────
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    const hash = window.location.hash.replace(/^#\/?/, '');
    const parts = hash.split('/').filter(Boolean);

    if (parts[0] === 'qr') {
      setPage('qr');
      return;
    }

    if (parts[0] === 'sync') {
      setPage('sync');
      return;
    }

    if (parts[0] === 'push') {
      setPage('push');
      return;
    }

    if (parts[0] === 'demo') {
      setQuery({ kind: 'friendCode', value: DEMO_FRIEND_CODE });
      void runQuery('friendCode', DEMO_FRIEND_CODE, true);
      return;
    }
    if (parts[0] === 'b50' && parts[1]) {
      const kind: QueryKind = parts[1] === 'qq' ? 'qq' : 'friendCode';
      const value = kind === 'qq' ? (parts[2] ?? '') : parts[1];
      if (value) {
        setQuery({ kind, value });
        void runQuery(kind, value, false);
      }
    }
  }, [runQuery]);

  const handleSubmit = useCallback(
    (next: { kind: QueryKind; value: string }) => {
      setQuery(next);
      window.location.hash =
        next.kind === 'qq' ? `#/b50/qq/${next.value}` : `#/b50/${next.value}`;
      void runQuery(next.kind, next.value, false);
    },
    [runQuery],
  );

  const handleDemo = useCallback(() => {
    setQuery({ kind: 'friendCode', value: DEMO_FRIEND_CODE });
    window.location.hash = '#/demo';
    void runQuery('friendCode', DEMO_FRIEND_CODE, true);
  }, [runQuery]);

  // ── 分组 ──────────────────────────────────────────────────────────────
  const view = result?.view ?? null;

  const groups = useMemo(() => {
    if (!view) return { mix: [], standard: [], dx: [], selections: [] } as Record<Tab, B50Entry[]>;
    const mix = [...view.standard, ...view.dx].sort(
      (a, b) => (b.rating ?? b.computedRating ?? 0) - (a.rating ?? a.computedRating ?? 0),
    );
    const selections = [...view.standardSelections, ...view.dxSelections].sort(
      (a, b) => (b.rating ?? b.computedRating ?? 0) - (a.rating ?? a.computedRating ?? 0),
    );
    return { mix, standard: view.standard, dx: view.dx, selections };
  }, [view]);

  const entries = groups[tab];
  const selectedEntry = useMemo(
    () => (selectedKey ? entries.find((entry) => entryKey(entry) === selectedKey) ?? null : null),
    [entries, selectedKey],
  );

  const handleSelect = useCallback((entry: B50Entry) => {
    const key = entryKey(entry);
    setSelectedKey((current) => (current === key ? null : key));
  }, []);

  const exportText = useCallback(async () => {
    if (!view) return;
    const lines: string[] = [];
    lines.push(`${view.player.name}  DX Rating ${formatInt(view.player.rating)}`);
    lines.push(
      `旧曲 Best 35: ${formatInt(view.stats.standardTotal)}　新曲 Best 15: ${formatInt(view.stats.dxTotal)}`,
    );
    lines.push('');
    lines.push('== 旧曲 Best 35 ==');
    view.standard.forEach((entry, index) => lines.push(formatLine(index + 1, entry)));
    lines.push('');
    lines.push('== 新曲 Best 15 ==');
    view.dx.forEach((entry, index) => lines.push(formatLine(index + 1, entry)));
    lines.push('');
    lines.push(`生成时间 ${view.generatedAt}`);

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  }, [view]);

  const mode = result?.mode ?? health?.mode ?? null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__name">AstraMai</span>
          <span className="brand__sub">舞萌 DX 查分测试站 · Vela 端基础工程</span>
        </div>

        {mode ? (
          <span className={`badge ${mode === 'live' ? 'badge--live' : 'badge--mock'}`}>
            {mode === 'live' ? '真实接口 LIVE' : mode === 'mock' ? '模拟数据 MOCK' : '未配置'}
          </span>
        ) : null}

        {health ? (
          <span className="badge badge--muted" title="曲库来源与缓存状态">
            曲库 {formatInt(health.songCache.songCount)} 首
            {health.songCache.cached ? `（缓存 ${Math.round((health.songCache.ageMs ?? 0) / 1000)}s）` : ''}
          </span>
        ) : null}

        <span className="badge badge--muted" title={devKey ? '使用页面填写的密钥' : '使用服务端密钥'}>
          {devKey ? '页面密钥' : health?.hasServerKey ? '服务端密钥' : '无密钥'}
        </span>

        <button className="btn btn--ghost btn--sm" type="button" onClick={() => setSettingsOpen(true)}>
          设置
        </button>
      </header>

      <nav className="nav" aria-label="主导航">
        <button
          type="button"
          aria-current={page === 'b50' ? 'page' : undefined}
          onClick={() => {
            setPage('b50');
            window.location.hash = lastQuery
              ? lastQuery.kind === 'qq'
                ? `#/b50/qq/${lastQuery.value}`
                : `#/b50/${lastQuery.value}`
              : '';
          }}
        >
          B50 查分
        </button>
        <button
          type="button"
          aria-current={page === 'qr' ? 'page' : undefined}
          onClick={() => {
            setPage('qr');
            window.location.hash = '#/qr';
          }}
        >
          二维码
        </button>
        <button
          type="button"
          aria-current={page === 'sync' ? 'page' : undefined}
          onClick={() => {
            setPage('sync');
            window.location.hash = '#/sync';
          }}
        >
          同步到手表
        </button>
        <button
          type="button"
          aria-current={page === 'push' ? 'page' : undefined}
          onClick={() => {
            setPage('push');
            window.location.hash = '#/push';
          }}
        >
          推分
        </button>
      </nav>

      {page === 'sync' ? (
        <SyncToWatch />
      ) : page === 'push' ? (
        <PushPlanner entries={result ? [...result.view.standard, ...result.view.dx] : null} />
      ) : page === 'qr' ? (
        <QrStudio />
      ) : (
        <>
          <QueryBar
            loading={loading}
            onSubmit={handleSubmit}
            onDemo={handleDemo}
            initialKind={query.kind}
            initialValue={query.value}
          />

      {healthError ? (
        <div className="alert alert--error">
          <div>
            <div className="alert__title">连不上本地服务端</div>
            <div className="alert__detail">{healthError}</div>
            <div style={{ marginTop: 6, color: 'var(--text-dim)', fontSize: 13 }}>
              请确认已经运行 <code>npm run dev</code>，并且只开了一个服务端实例。
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="alert alert--error">
          <div>
            <div className="alert__title">{error.friendlyMessage}</div>
            {error.detail ? <div className="alert__detail">{error.detail}</div> : null}
            {error.status ? (
              <div style={{ marginTop: 6, color: 'var(--text-dim)', fontSize: 12.5 }}>
                HTTP {error.status}
                {error.endpoint ? ` · ${error.endpoint}` : ''}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {!result && !error ? <EmptyState onDemo={handleDemo} hasServerKey={health?.hasServerKey ?? false} /> : null}

      {view ? (
        <>
          {result?.mode === 'mock' ? (
            <div className="alert alert--warn">
              <div>
                <div className="alert__title">当前展示的是模拟数据</div>
                <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>
                  服务端没有可用密钥，已自动降级为 Mock。
                  {result.librarySource === 'lxns'
                    ? '曲目信息仍来自落雪公共接口，成绩为内置生成。'
                    : '连曲库也用了内置合成数据（落雪不可达）。'}
                  在「设置」中填入开发者密钥即可查真实数据。
                </div>
              </div>
            </div>
          ) : null}

          <PlayerCard view={view} />
          {/*
            和上次比。
            放在名片下面第一屏就能看到 —— 这是"我进步了吗"，
            比后面的统计面板更贴近玩家当下的关心。
          */}
          {diff ? <B50DiffPanel diff={diff} /> : null}
          <StatsPanel stats={view.stats} />
          <SelfCheckPanel selfCheck={view.selfCheck} stats={view.stats} />

          {view.warnings.length > 0 ? (
            <section className="card warnings">
              <div className="card__title" style={{ marginBottom: 0 }}>
                数据提示（{view.warnings.length}）
              </div>
              <ul>
                {view.warnings.slice(0, 8).map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
                {view.warnings.length > 8 ? <li>…还有 {view.warnings.length - 8} 条</li> : null}
              </ul>
            </section>
          ) : null}

          <div className="tabs" role="tablist">
            <TabButton current={tab} value="mix" onSelect={setTab} label={`全部 50（${groups.mix.length}）`} />
            <TabButton
              current={tab}
              value="standard"
              onSelect={setTab}
              label={`旧曲 Best 35（${view.standard.length}）`}
            />
            <TabButton current={tab} value="dx" onSelect={setTab} label={`新曲 Best 15（${view.dx.length}）`} />
            <TabButton
              current={tab}
              value="selections"
              onSelect={setTab}
              label={`Selection 20（${groups.selections.length}）`}
            />
            <button
              className="btn btn--ghost btn--sm"
              type="button"
              style={{ marginLeft: 'auto', alignSelf: 'center' }}
              onClick={() => void exportText()}
            >
              {copied ? '已复制到剪贴板' : '复制 B50 文本'}
            </button>
          </div>

          <ScoreTable
            entries={entries}
            selectedKey={selectedKey}
            onSelect={handleSelect}
            showRank={tab !== 'standard' && tab !== 'dx'}
            emptyText={tab === 'selections' ? '落雪没有返回 Selection 数据。' : '这个分组没有成绩。'}
          />

          {selectedEntry ? <ScoreDetail entry={selectedEntry} onClose={() => setSelectedKey(null)} /> : null}

          <p className="footnote">
            数据来源：<a href="https://maimai.lxns.net" target="_blank" rel="noreferrer">落雪查分器</a>
            {' · '}
            接口耗时 {result?.elapsedMs ?? 0} ms
            {' · '}
            生成于 {formatRelative(view.generatedAt)}
            {lastQuery ? ` · 查询${lastQuery.mock ? '（演示）' : ''} ${lastQuery.value}` : ''}
          </p>
        </>
      ) : null}
        </>
      )}

      <SettingsDialog
        open={settingsOpen}
        initialKey={devKey}
        hasServerKey={health?.hasServerKey ?? false}
        allowClientKey={health?.allowClientKey ?? true}
        onSave={(key) => {
          writeStoredKey(key);
          setDevKey(key);
        }}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

function TabButton({
  current,
  value,
  label,
  onSelect,
}: {
  current: Tab;
  value: Tab;
  label: string;
  onSelect: (tab: Tab) => void;
}) {
  return (
    <button type="button" role="tab" aria-selected={current === value} onClick={() => onSelect(value)}>
      {label}
    </button>
  );
}

function EmptyState({ onDemo, hasServerKey }: { onDemo: () => void; hasServerKey: boolean }) {
  return (
    <div className="empty">
      <h2>输入好友码，查一份 Best 50</h2>
      <p>
        会返回玩家名片、B35/B15 构成、统计、逐条 <code>dx_rating</code> 公式对拍，以及每条成绩的定数、物量与推分空间。
      </p>
      <p>
        没有开发者密钥也能用：点「看演示数据」，或者直接{' '}
        <button className="btn btn--ghost btn--sm" type="button" onClick={onDemo}>
          载入 Mock B50
        </button>
        。
      </p>
      {!hasServerKey ? (
        <p style={{ fontSize: 13 }}>
          当前服务端未配置 <code>LXNS_API_KEY</code>，真实查询需要在「设置」里临时填密钥。
        </p>
      ) : null}
    </div>
  );
}

function formatLine(rank: number, entry: B50Entry): string {
  const marks = [entry.fc ? FC_LABELS[entry.fc] : '', entry.fs ? FS_LABELS[entry.fs] : '']
    .filter(Boolean)
    .join('/');
  return [
    `${String(rank).padStart(2, ' ')}.`,
    `[${entry.difficultyShort} ${entry.level}(${formatLevelValue(entry.levelValue)})]`,
    entry.title,
    formatAchievement(entry.achievements),
    `DX ${entry.dxScore}`,
    marks || '-',
    `${entry.rating ?? entry.computedRating ?? '--'}`,
  ].join(' ');
}
