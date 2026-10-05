import type { B50Stats, RatingSelfCheck } from '@astramai/core';
import { formatAchievement, formatFixed, formatInt } from '@astramai/core';

interface SelfCheckPanelProps {
  selfCheck: RatingSelfCheck;
  stats: B50Stats;
}

/**
 * 公式自检面板。
 *
 * 存在的理由：DX Rating 的系数表与 AP 加分属于「社区整理 + 官方说明」的细节，
 * 与其相信注释，不如每次查询都用落雪返回的 dx_rating 逐条对拍。
 * 真实密钥下跑一次就能拿到数百条的统计结论。
 */
export function SelfCheckPanel({ selfCheck, stats }: SelfCheckPanelProps) {
  const { checked, matched, mismatched, missingApiRating, matchedWithoutApBonus, includesApBonus } = selfCheck;

  const subtotalOk = stats.computedStandardDelta === 0 && stats.computedDxDelta === 0;

  if (checked === 0) {
    return (
      <section className="card selfcheck">
        <div className="selfcheck__head">
          <h3 className="card__title">公式自检</h3>
          <span className="badge badge--muted">无数据</span>
        </div>
        <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: '10px 0 0' }}>
          {missingApiRating > 0
            ? `本次响应的 ${missingApiRating} 条成绩都没有 dx_rating 字段，无法对拍。`
            : '没有可用于对拍的成绩（可能缺少谱面定数）。'}
        </p>
      </section>
    );
  }

  const allMatched = mismatched === 0;

  return (
    <section className="card selfcheck">
      <div className="selfcheck__head">
        <h3 className="card__title">公式自检</h3>
        <span className={`badge ${allMatched ? 'badge--live' : 'badge--warn'}`}>
          {allMatched ? `全部一致 ${matched}/${checked}` : `不一致 ${mismatched}/${checked}`}
        </span>
        {includesApBonus === true ? (
          <span className="badge badge--muted">落雪 dx_rating 含 AP 加分</span>
        ) : includesApBonus === false ? (
          <span className="badge badge--warn">落雪 dx_rating 不含 AP 加分</span>
        ) : (
          <span className="badge badge--muted">AP 加分无法判定</span>
        )}
      </div>

      <div className="selfcheck__grid">
        <div className="stat">
          <div className="stat__label">参与对拍</div>
          <div className="stat__value">{checked}</div>
          <div className="stat__sub">需要有定数且落雪返回了 dx_rating</div>
        </div>
        <div className="stat">
          <div className="stat__label">完全一致</div>
          <div className="stat__value" style={{ color: matched === checked ? '#a7f3d0' : undefined }}>
            {matched}
          </div>
          <div className="stat__sub">本地公式 floor(定数 × 达成率 × 系数 + AP 加分)</div>
        </div>
        <div className="stat">
          <div className="stat__label">不一致</div>
          <div className="stat__value" style={{ color: mismatched === 0 ? '#a7f3d0' : '#fecaca' }}>
            {mismatched}
          </div>
          <div className="stat__sub">{mismatched === 0 ? '公式与接口语义吻合' : '见下方样例'}</div>
        </div>
        <div className="stat">
          <div className="stat__label">忽略 AP 加分后一致</div>
          <div className="stat__value">{matchedWithoutApBonus}</div>
          <div className="stat__sub">用来判断接口是否已含加分</div>
        </div>
        <div className="stat">
          <div className="stat__label">小计对拍</div>
          <div className="stat__value" style={{ color: subtotalOk ? '#a7f3d0' : '#fecaca' }}>
            {subtotalOk ? 'B35 / B15 均一致' : '有偏差'}
          </div>
          <div className="stat__sub">
            旧曲 {formatInt(stats.computedStandardTotal)}/{formatInt(stats.standardTotal)}
            {' · '}
            新曲 {formatInt(stats.computedDxTotal)}/{formatInt(stats.dxTotal)}
          </div>
        </div>
      </div>

      {mismatched > 0 && selfCheck.samples.length > 0 ? (
        <details className="selfcheck__samples" open>
          <summary style={{ cursor: 'pointer', color: 'var(--text-dim)', fontSize: 13 }}>
            不一致样例（最多 12 条）
          </summary>
          <table className="mini">
            <thead>
              <tr>
                <th>曲名</th>
                <th>难度</th>
                <th>定数</th>
                <th>达成率</th>
                <th>FC</th>
                <th>本地</th>
                <th>本地(不含AP)</th>
                <th>落雪</th>
              </tr>
            </thead>
            <tbody>
              {selfCheck.samples.map((sample) => (
                <tr key={`${sample.songId}-${sample.difficulty}-${sample.achievements}`}>
                  <td>{sample.title}</td>
                  <td>{sample.difficulty}</td>
                  <td>{formatFixed(sample.levelValue, 1)}</td>
                  <td>{formatAchievement(sample.achievements)}</td>
                  <td>{sample.fc ?? '—'}</td>
                  <td>{sample.computed}</td>
                  <td>{sample.computedWithoutApBonus}</td>
                  <td>{sample.api ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}

      {missingApiRating > 0 ? (
        <p style={{ color: 'var(--text-dim)', fontSize: 12.5, margin: '12px 0 0' }}>
          另有 {missingApiRating} 条成绩未被落雪返回 dx_rating，已排除在对拍之外。
        </p>
      ) : null}
    </section>
  );
}
