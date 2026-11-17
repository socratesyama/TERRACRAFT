import type { DataBundle } from '../core/data/schema';
import { SHOWCASE_SCENARIOS, resolveScenario } from '../core/pipeline';
import { biomeKeys } from '../core/climate/climate';
import { biomeLabel, t, type MessageKey } from './i18n';
import { useUiStore, useWorldMirror, type LayerId } from './store';

const LAYERS: readonly { id: LayerId; label: MessageKey }[] = [
  { id: 'terrain', label: 'layer.terrain' },
  { id: 'precip', label: 'layer.precip' },
  { id: 'temperature', label: 'layer.temperature' },
  { id: 'moisture', label: 'layer.moisture' },
  { id: 'biome', label: 'layer.biome' },
  { id: 'vegetation', label: 'layer.vegetation' },
  { id: 'erosion', label: 'layer.erosion' },
];

/** 数値は data/ と Worker の統計だけを表示する（創作した数値は出さない） */
export function StatsPanel({ data, seed, size }: { data: DataBundle; seed: number; size: number }) {
  const { tick, avgTickMs, vegetation } = useWorldMirror();
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
      <dl className="kv">
        <dt>{t('stats.vegetation')}</dt>
        <dd>{(vegetation * 100).toFixed(0)} %</dd>
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
export function LayerPanel({ data }: { data: DataBundle }) {
  const precipMaxMm = data.runtime.render.precipLayerMaxMm;
  const tr = data.runtime.render.temperatureLayerRange;
  const colors = data.runtime.render.biomeColors as Record<string, string>;
  const layer = useUiStore((s) => s.layer);
  const setLayer = useUiStore((s) => s.setLayer);

  return (
    <section className="panel" aria-labelledby="layers-title">
      <h2 id="layers-title">{t('panel.layers')}</h2>
      <div className="choices" role="radiogroup" aria-label={t('panel.layers')}>
        {LAYERS.map(({ id, label }) => {
          const enabled = id !== 'erosion';
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
      {layer === 'temperature' && (
        <div className="legend" aria-label={t('layer.temperature')}>
          <div className="legend-bar legend-temp" aria-hidden="true" />
          <div className="legend-labels">
            <span>
              {t('legend.cold')} {tr.minC} °C
            </span>
            <span>
              {tr.maxC} °C {t('legend.hot')}
            </span>
          </div>
        </div>
      )}
      {layer === 'moisture' && (
        <div className="legend" aria-label={t('legend.moisture')}>
          <div className="legend-bar legend-moist" aria-hidden="true" />
          <div className="legend-labels">
            <span>{t('legend.dry')} 0</span>
            <span>1 {t('legend.wet')}</span>
          </div>
        </div>
      )}
      {layer === 'vegetation' && (
        <div className="legend" aria-label={t('legend.vegetation')}>
          <div className="legend-bar legend-veg" aria-hidden="true" />
          <div className="legend-labels">
            <span>{t('legend.bare')} 0</span>
            <span>1 {t('legend.dense')}</span>
          </div>
        </div>
      )}
      {layer === 'biome' && (
        <ul className="swatches">
          {biomeKeys(data).map((k) => (
            <li key={k}>
              <span className="swatch" style={{ background: colors[k] }} aria-hidden="true" />
              {biomeLabel(k)}
            </li>
          ))}
        </ul>
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

/** 各バイオームが全セルに占める割合（Worker の統計をそのまま表示する） */
export function BiomePanel({ data }: { data: DataBundle }) {
  const share = useWorldMirror((s) => s.biomeShare);
  const keys = biomeKeys(data);
  const rows = keys
    .map((k, i) => ({ k, v: share[i] ?? 0 }))
    .filter((r) => r.v > 0.0005 && r.k !== 'water')
    .sort((a, b) => b.v - a.v);
  return (
    <section className="panel" aria-labelledby="biomes-title">
      <h2 id="biomes-title">{t('panel.biomes')}</h2>
      <dl className="kv">
        {rows.map((r) => (
          <div key={r.k} className="kv-row">
            <dt>{biomeLabel(r.k)}</dt>
            <dd>{(r.v * 100).toFixed(1)} %</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** 開発者向け: 降水倍率（乾燥化・湿潤化の実験）。通常の干渉ツールではない（§21） */
export function DevPanel({
  data,
  onRainfall,
}: {
  data: DataBundle;
  onRainfall: (v: number) => void;
}) {
  const v = useUiStore((s) => s.rainfallScale);
  const setV = useUiStore((s) => s.setRainfallScale);
  const r = data.runtime.ui.devRainfallScale;
  return (
    <section className="panel" aria-labelledby="dev-title">
      <h2 id="dev-title">{t('panel.dev')}</h2>
      <label className="slider">
        <span>
          {t('dev.rainfall')} ×{v.toFixed(1)}
        </span>
        <input
          type="range"
          min={r.min}
          max={r.max}
          step={r.step}
          value={v}
          onChange={(e) => {
            const next = Number(e.target.value);
            setV(next);
            onRainfall(next);
          }}
        />
      </label>
    </section>
  );
}
