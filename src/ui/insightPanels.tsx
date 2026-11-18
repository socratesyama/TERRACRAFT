import { useMemo, useState } from 'react';
import type { CompareResult, CompareSpec } from '../core/compare';
import type { DataBundle } from '../core/data/schema';
import { SHOWCASE_SCENARIOS, resolveScenario } from '../core/pipeline';
import { t } from './i18n';
import { useUiStore, useWorldMirror } from './store';

interface Line {
  label: string;
  color: string;
  dash?: string;
  values: number[];
}

const DASHES = [undefined, '5 3', '2 2', '8 3 2 3'];

/** 折れ線グラフ。色だけに頼らず、線の種類（実線・破線…）と凡例の最新値で区別する */
export function LineChart({ ticks, lines, title }: { ticks: number[]; lines: Line[]; title: string }) {
  const all = lines.flatMap((l) => l.values);
  if (ticks.length < 2 || all.length === 0) return <p className="note">{t('observe.empty')}</p>;
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const W = 300;
  const H = 110;
  const px = (i: number) => 8 + (i / (ticks.length - 1)) * (W - 16);
  const py = (v: number) => 8 + (1 - (v - lo) / span) * (H - 16);
  const fmt = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('ja-JP') : v.toFixed(2));
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="chart-svg">
        <text x="9" y="10" className="chart-axis">{fmt(hi)}</text>
        <text x="9" y={H - 2} className="chart-axis">{fmt(lo)}</text>
        {lines.map((l) => (
          <polyline
            key={l.label}
            fill="none"
            stroke={l.color}
            strokeWidth="1.8"
            strokeDasharray={l.dash}
            points={l.values.map((v, i) => `${px(i)},${py(v)}`).join(' ')}
          />
        ))}
      </svg>
      <figcaption className="chart-x">
        {ticks[0]} 〜 {ticks[ticks.length - 1]} 年
      </figcaption>
      <ul className="legend-list">
        {lines.map((l) => (
          <li key={l.label}>
            <svg width="22" height="8" aria-hidden="true">
              <line x1="0" y1="4" x2="22" y2="4" stroke={l.color} strokeWidth="2" strokeDasharray={l.dash} />
            </svg>
            {l.label}: {fmt(l.values[l.values.length - 1]!)}
          </li>
        ))}
      </ul>
    </figure>
  );
}

const metricTitle = (data: DataBundle, id: string): string => {
  const m = (data.observables.metrics as Record<string, { title: string; unit: string }>)[id];
  return m ? `${m.title}（${m.unit}）` : id;
};

/** 観測量の時系列（国ごと、または世界）。指標は observables.json の定義 */
export function ObservablesPanel({ data }: { data: DataBundle }) {
  const obs = useWorldMirror((s) => s.obs);
  const ids = useMemo(() => [...new Set(Object.keys(obs.values).map((k) => k.split(':')[0]!))], [obs]);
  const [metric, setMetric] = useState('developmentIndex');
  const id = ids.includes(metric) ? metric : (ids[0] ?? '');
  const lines: Line[] = Object.keys(obs.values)
    .filter((k) => k.split(':')[0] === id)
    .map((k) => {
      const nid = k.includes(':') ? Number(k.split(':')[1]) : 0;
      return {
        label: nid ? (data.nations.setup.names[nid - 1] ?? `国${nid}`) : '世界',
        color: nid ? (data.nations.setup.colors[nid - 1] ?? '#aaa') : '#dddddd',
        dash: nid ? DASHES[(nid - 1) % DASHES.length] : undefined,
        values: obs.values[k]!,
      };
    });
  return (
    <section className="panel" aria-labelledby="obs-title">
      <h2 id="obs-title">{t('panel.observe')}</h2>
      <label className="field">
        <span>{t('observe.metric')}</span>
        <select value={id} onChange={(e) => setMetric(e.target.value)}>
          {ids.map((m) => (
            <option key={m} value={m}>
              {metricTitle(data, m)}
            </option>
          ))}
        </select>
      </label>
      <LineChart ticks={obs.ticks} lines={lines} title={metricTitle(data, id)} />
    </section>
  );
}

function seriesOf(r: CompareResult, which: 'a' | 'b', id: string): number[] {
  const o = r[which];
  if (o.values[id]) return o.values[id]!;
  const keys = Object.keys(o.values).filter((k) => k.startsWith(`${id}:`));
  if (keys.length === 0) return [];
  return o.ticks.map((_, i) => keys.reduce((a, k) => a + o.values[k]![i]!, 0) / keys.length);
}

/** シナリオ比較: 同じ seed で 2 つの世界を進め、指標の差（Δ）と比、推移を並べる */
export function ComparePanel({ data, onRun }: { data: DataBundle; onRun: (a: CompareSpec, b: CompareSpec, ticks: number) => void }) {
  const cfg = data.runtime.observe.compareTicks;
  const [a, setA] = useState<string>(SHOWCASE_SCENARIOS[0]!);
  const [b, setB] = useState<string>(SHOWCASE_SCENARIOS[1] ?? SHOWCASE_SCENARIOS[0]!);
  const [ticks, setTicks] = useState<number>(cfg.value);
  const [pick, setPick] = useState('developmentIndex');
  const result = useUiStore((s) => s.compare);
  const progress = useUiStore((s) => s.compareProgress);
  const setProgress = useUiStore((s) => s.setCompareProgress);
  const nationMode = useUiStore((s) => s.nationMode);
  const opts = SHOWCASE_SCENARIOS.map((id) => (
    <option key={id} value={id}>
      {resolveScenario(data, id).title}
    </option>
  ));
  const fmt = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('ja-JP') : v.toFixed(2));
  const rowId = result?.rows.some((r) => r.id === pick) ? pick : (result?.rows[0]?.id ?? '');
  return (
    <section className="panel" aria-labelledby="cmp-title">
      <h2 id="cmp-title">{t('panel.compare')}</h2>
      <p className="note">{t('compare.same')}</p>
      <label className="field">
        <span>{t('compare.a')}</span>
        <select value={a} onChange={(e) => setA(e.target.value)}>{opts}</select>
      </label>
      <label className="field">
        <span>{t('compare.b')}</span>
        <select value={b} onChange={(e) => setB(e.target.value)}>{opts}</select>
      </label>
      <label className="slider">
        <span>
          {t('compare.ticks')} {ticks}
        </span>
        <input type="range" min={cfg.min} max={cfg.max} step={cfg.step} value={ticks} onChange={(e) => setTicks(Number(e.target.value))} />
      </label>
      <button
        type="button"
        className="primary"
        disabled={progress !== null}
        onClick={() => {
          setProgress(0);
          onRun({ scenarioId: a, nations: nationMode }, { scenarioId: b, nations: nationMode }, ticks);
        }}
      >
        {progress !== null ? `${t('compare.running')} ${Math.round(progress * 100)}%` : t('compare.run')}
      </button>
      {result && (
        <>
          <p className="insight">{result.insight}</p>
          <table className="cmp">
            <thead>
              <tr>
                <th scope="col">{t('observe.metric')}</th>
                <th scope="col">A</th>
                <th scope="col">B</th>
                <th scope="col">{t('compare.delta')}</th>
                <th scope="col">{t('compare.ratio')}</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.id} className={r.id === rowId ? 'sel' : undefined}>
                  <th scope="row">
                    <button type="button" className="link" onClick={() => setPick(r.id)}>
                      {r.title}
                    </button>
                  </th>
                  <td>{fmt(r.a)}</td>
                  <td>{fmt(r.b)}</td>
                  <td>{r.delta >= 0 ? '+' : ''}{fmt(r.delta)}</td>
                  <td>{Number.isFinite(r.ratio) ? `×${r.ratio.toFixed(2)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 className="sub">{t('compare.chart')}: {metricTitle(data, rowId)}</h3>
          <LineChart
            ticks={result.ticks}
            title={metricTitle(data, rowId)}
            lines={[
              { label: `A ${resolveScenario(data, result.specs[0].scenarioId).title}`, color: '#6cb2ff', values: seriesOf(result, 'a', rowId) },
              { label: `B ${resolveScenario(data, result.specs[1].scenarioId).title}`, color: '#ffb454', dash: '5 3', values: seriesOf(result, 'b', rowId) },
            ]}
          />
        </>
      )}
    </section>
  );
}

/** 因果トレーサ: 操作を選ぶと、causeId でひもづいた結果を時系列に並べる。変化マップの基準も取り直せる */
export function TracerPanel({ onFocus, onMark }: { onFocus: (x: number, y: number) => void; onMark: () => void }) {
  const events = useUiStore((s) => s.events);
  const sel = useUiStore((s) => s.traceSeq);
  const setSel = useUiStore((s) => s.setTraceSeq);
  const ops = events.filter((e) => e.kind === 'op' && e.opId !== undefined).slice(-12).reverse();
  const chosen = ops.find((e) => e.seq === sel);
  const effects = chosen ? events.filter((e) => e.causeId === chosen.opId) : [];
  return (
    <section className="panel" aria-labelledby="trace-title">
      <h2 id="trace-title">{t('panel.trace')}</h2>
      {ops.length === 0 ? (
        <p className="note">{t('trace.none')}</p>
      ) : (
        <>
          <p className="note">{t('trace.pick')}</p>
          <ul className="events">
            {ops.map((e) => (
              <li key={e.seq}>
                <button type="button" aria-pressed={e.seq === sel} className={e.seq === sel ? 'active' : undefined} onClick={() => setSel(e.seq === sel ? null : (e.seq ?? null))}>
                  <span className="ev-tick">{e.tick}年</span>
                  <span className="ev-msg">#{(e.opId ?? 0) + 1} {e.message}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {chosen && (
        <>
          <h3 className="sub">{t('trace.effects')}</h3>
          {effects.length === 0 && <p className="note">{t('trace.noeffects')}</p>}
          <ul className="events">
            {effects.map((e) => (
              <li key={e.seq}>
                <button type="button" disabled={e.x === undefined} onClick={() => e.x !== undefined && e.y !== undefined && onFocus(e.x, e.y)}>
                  <span className="ev-tick">+{e.tick - chosen.tick}年</span>
                  <span className="ev-msg">{e.message}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <button type="button" className="choice" onClick={onMark}>
        {t('trace.mark')}
      </button>
      <p className="note">{t('trace.hint')}</p>
    </section>
  );
}
