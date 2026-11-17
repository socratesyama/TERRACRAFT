import type { DataBundle } from '../core/data/schema';
import { SHOWCASE_SCENARIOS, resolveScenario } from '../core/pipeline';
import { t, type MessageKey } from './i18n';
import { useUiStore, useWorldMirror, type LayerId } from './store';

const LAYERS: readonly { id: LayerId; label: MessageKey }[] = [
  { id: 'terrain', label: 'layer.terrain' },
  { id: 'precip', label: 'layer.precip' },
  { id: 'temperature', label: 'layer.temperature' },
  { id: 'moisture', label: 'layer.moisture' },
  { id: 'erosion', label: 'layer.erosion' },
];

/** 数値は data/ と Worker の統計だけを表示する（創作した数値は出さない） */
export function StatsPanel({ data, seed, size }: { data: DataBundle; seed: number; size: number }) {
  const { tick, avgTickMs } = useWorldMirror();
  const budget = data.runtime.tick.budgetMs;
  const ratio = Math.min(1, avgTickMs / budget);

  return (
    <section className="panel" aria-labelledby="stats-title">
      <h2 id="stats-title">{t('panel.stats')}</h2>
      <dl className="kv">
        <dt>{t('status.tick')}</dt>
        <dd>{tick}</dd>
        <dt>{t('stats.seed')}</dt>
        <dd>{seed}</dd>
        <dt>{t('stats.grid')}</dt>
        <dd>
          {size} × {size}
        </dd>
        <dt>{t('stats.cell')}</dt>
        <dd>
          {data.scale.cellSize.value} {data.scale.cellSize.unit}
        </dd>
      </dl>
      <div className="meter">
        <div className="meter-head">
          <span>{t('stats.tickCost')}</span>
          <span>
            {avgTickMs.toFixed(2)} / {budget} ms
          </span>
        </div>
        <div
          className="meter-track"
          role="meter"
          aria-label={t('stats.tickCost')}
          aria-valuemin={0}
          aria-valuemax={budget}
          aria-valuenow={Number(avgTickMs.toFixed(2))}
        >
          <div className="meter-fill" style={{ width: `${ratio * 100}%` }} />
        </div>
      </div>
    </section>
  );
}

/** レイヤー切替。地形が入る M1（降水・水分）と M3（侵食）まで、地形以外は無効にしておく */
export function LayerPanel({ precipMaxMm }: { precipMaxMm: number }) {
  const layer = useUiStore((s) => s.layer);
  const setLayer = useUiStore((s) => s.setLayer);

  return (
    <section className="panel" aria-labelledby="layers-title">
      <h2 id="layers-title">{t('panel.layers')}</h2>
      <div className="choices" role="radiogroup" aria-label={t('panel.layers')}>
        {LAYERS.map(({ id, label }) => {
          const enabled = id === 'terrain' || id === 'precip';
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={layer === id}
              disabled={!enabled}
              className={layer === id ? 'choice active' : 'choice'}
              onClick={() => setLayer(id)}
            >
              {t(label)}
            </button>
          );
        })}
      </div>
      {layer === 'precip' && (
        <div className="legend" aria-label={t('legend.precip')}>
          <div className="legend-bar" aria-hidden="true" />
          <div className="legend-labels">
            <span>{t('legend.dry')} 0</span>
            <span>
              {precipMaxMm} mm/年 {t('legend.wet')}
            </span>
          </div>
        </div>
      )}
      <p className="note">{t('panel.layers.soon')}</p>
    </section>
  );
}

export function ScenarioPanel({ data }: { data: DataBundle }) {
  const scenarioId = useUiStore((s) => s.scenarioId);
  const setScenarioId = useUiStore((s) => s.setScenarioId);
  return (
    <section className="panel" aria-labelledby="scenario-title">
      <h2 id="scenario-title">{t('panel.scenario')}</h2>
      <div className="choices" role="radiogroup" aria-label={t('panel.scenario')}>
        {SHOWCASE_SCENARIOS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={scenarioId === id}
            className={scenarioId === id ? 'choice active' : 'choice'}
            onClick={() => setScenarioId(id)}
          >
            {resolveScenario(data, id).title}
          </button>
        ))}
      </div>
    </section>
  );
}
