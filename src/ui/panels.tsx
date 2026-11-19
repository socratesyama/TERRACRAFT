import type { DataBundle } from '../core/data/schema';
import { SHOWCASE_SCENARIOS, resolveScenario } from '../core/pipeline';
import { biomeKeys } from '../core/climate/climate';
import { biomeLabel, t, type MessageKey } from './i18n';
import { useUiStore, useWorldMirror, type LayerId, type ToolId } from './store';

const LAYERS: readonly { id: LayerId; label: MessageKey }[] = [
  { id: 'terrain', label: 'layer.terrain' },
  { id: 'precip', label: 'layer.precip' },
  { id: 'temperature', label: 'layer.temperature' },
  { id: 'moisture', label: 'layer.moisture' },
  { id: 'biome', label: 'layer.biome' },
  { id: 'vegetation', label: 'layer.vegetation' },
  { id: 'flood', label: 'layer.flood' },
  { id: 'nation', label: 'layer.nation' },
  { id: 'defense', label: 'layer.defense' },
  { id: 'diff', label: 'layer.diff' },
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
          const enabled = true;
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
      {layer === 'erosion' && (
        <div className="legend" aria-label={t('layer.erosion')}>
          <div className="legend-bar legend-erosion" aria-hidden="true" />
          <div className="legend-labels">
            <span>{t('legend.eroded')} {Math.round(data.runtime.render.erosionLayerScale.value * data.scale.maxElevation.value)} m</span>
            <span>{t('legend.deposited')}</span>
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
      {layer === 'defense' && (
        <div className="legend" aria-label={t('legend.defense')}>
          <div className="legend-bar legend-defense" aria-hidden="true" />
          <div className="legend-labels">
            <span>{t('legend.defense.low')}</span>
            <span>{t('legend.defense.high')}</span>
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
    </section>
  );
}

export function ScenarioPanel({ data }: { data: DataBundle }) {
  const scenarioId = useUiStore((s) => s.scenarioId);
  const setScenarioId = useUiStore((s) => s.setScenarioId);
  const nationMode = useUiStore((s) => s.nationMode);
  const setNationMode = useUiStore((s) => s.setNationMode);
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
      <button type="button" className="choice" onClick={() => useUiStore.getState().startContour((data.runtime.ui as unknown as { contour: { defaultLevel: string } }).contour.defaultLevel)}>
        {t('contour.start')}
      </button>
      <label className="check">
        <input type="checkbox" checked={nationMode} onChange={(e) => setNationMode(e.target.checked)} />
        <span>{t('scenario.nationMode')}</span>
      </label>
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
  onPeace,
  onErosion,
}: {
  data: DataBundle;
  onRainfall: (v: number) => void;
  onPeace: (v: boolean) => void;
  onErosion: (v: number) => void;
}) {
  const er = data.hydrology.streamPower.rate;
  const erosionRate = useUiStore((s) => s.erosionRate) ?? er.default;
  const setErosionRate = useUiStore((s) => s.setErosionRate);
  const peace = useUiStore((s) => s.peaceMode);
  const setPeace = useUiStore((s) => s.setPeaceMode);
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
      <label className="slider">
        <span>
          {t('dev.erosion')} ×{erosionRate}
        </span>
        <input
          type="range"
          min={er.min}
          max={er.max}
          step={er.step}
          value={erosionRate}
          onChange={(e) => {
            const next = Number(e.target.value);
            setErosionRate(next);
            onErosion(next);
          }}
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={peace}
          onChange={(e) => {
            setPeace(e.target.checked);
            onPeace(e.target.checked);
          }}
        />
        <span>{t('dev.peace')}</span>
      </label>
    </section>
  );
}

export const TOOLS: readonly { id: ToolId; label: MessageKey }[] = [
  { id: 'contour', label: 'tool.contour' },
  { id: 'view', label: 'tool.view' },
  { id: 'mountain', label: 'tool.mountain' },
  { id: 'dig', label: 'tool.dig' },
  { id: 'afforest', label: 'tool.afforest' },
  { id: 'deforest', label: 'tool.deforest' },
  { id: 'dam', label: 'tool.dam' },
  { id: 'fill', label: 'tool.fill' },
];

/** 干渉ツール（§9.2）と元に戻す／やり直す（§9.3） */
export function ToolPanel({
  data,
  onUndo,
  onRedo,
  onRain,
}: {
  data: DataBundle;
  onUndo: () => void;
  onRedo: () => void;
  onRain: () => void;
}) {
  const tool = useUiStore((s) => s.tool);
  const setTool = useUiStore((s) => s.setTool);
  const radius = useUiStore((s) => s.brushRadius);
  const setRadius = useUiStore((s) => s.setBrushRadius);
  const crest = useUiStore((s) => s.damCrest);
  const setCrest = useUiStore((s) => s.setDamCrest);
  const undoDepth = useWorldMirror((s) => s.undoDepth);
  const redoDepth = useWorldMirror((s) => s.redoDepth);
  const tl = data.runtime.ui.tools;
  const hint = tool === 'view' ? 'tool.hint.view' : tool === 'dam' ? 'tool.hint.dam' : 'tool.hint.paint';
  return (
    <section className="panel" aria-labelledby="tools-title">
      <h2 id="tools-title">{t('panel.tools')}</h2>
      <div className="choices wrap" role="radiogroup" aria-label={t('panel.tools')}>
        {TOOLS.filter((x) => x.id !== 'contour').map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={tool === id}
            className={tool === id ? 'choice active' : 'choice'}
            onClick={() => setTool(id)}
          >
            {t(label)}
          </button>
        ))}
      </div>
      <p className="note">{t(hint)}</p>
      {tool !== 'view' && tool !== 'dam' && (
        <label className="slider">
          <span>
            {t('tool.radius')} {(radius * 100).toFixed(0)}%
          </span>
          <input
            type="range"
            min={tl.brushRadius.min}
            max={tl.brushRadius.max}
            step={0.01}
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
          />
        </label>
      )}
      {tool === 'dam' && (
        <label className="slider">
          <span>
            {t('tool.crest')} {Math.round(crest * data.scale.maxElevation.value)} m
          </span>
          <input
            type="range"
            min={tl.damCrest.min}
            max={tl.damCrest.max}
            step={0.01}
            value={crest}
            onChange={(e) => setCrest(Number(e.target.value))}
          />
        </label>
      )}
      <div className="row">
        <button type="button" className="action" onClick={onUndo} disabled={undoDepth === 0}>
          {t('tool.undo')}
        </button>
        <button type="button" className="action" onClick={onRedo} disabled={redoDepth === 0}>
          {t('tool.redo')}
        </button>
        <button type="button" className="action" onClick={onRain}>
          {t('tool.rain')}
        </button>
      </div>
    </section>
  );
}

const KIND_LABEL: Readonly<Record<string, string>> = {
  op: '操作',
  river: '川',
  lake: '湖',
  forest: '森',
  desert: '砂漠',
  settle: '集落',
  flood: '洪水',
  drought: '干ばつ',
  landslide: '土砂',
  road: '道路',
  abandon: '放棄',
  erosion: '侵食',
  deposit: '堆積',
};

/** できごとのログ（§9.4）。クリックでその場所へカメラが寄る。原因の操作がある行には印が付く。 */
export function EventLog({ onFocus }: { onFocus: (x: number, y: number) => void }) {
  const events = useUiStore((s) => s.events);
  const rows = events.filter((e) => e.kind !== 'road').slice(-60).reverse();
  return (
    <section className="panel" aria-labelledby="events-title">
      <h2 id="events-title">{t('panel.events')}</h2>
      {rows.length === 0 ? (
        <p className="note">{t('events.empty')}</p>
      ) : (
        <ul className="events" aria-live="polite">
          {rows.map((e) => {
            const focusable = e.x !== undefined && e.y !== undefined;
            const body = (
              <>
                <span className="ev-tick">{e.tick}年</span>
                <span className={`ev-kind kind-${e.kind}`}>{KIND_LABEL[e.kind] ?? e.kind}</span>
                <span className="ev-msg">{e.message}</span>
                {e.causeId !== undefined && (
                  <span className="ev-cause">
                    {t('events.cause')} #{e.causeId + 1}
                  </span>
                )}
              </>
            );
            return (
              <li key={e.seq ?? `${e.tick}-${e.message}`}>
                {focusable ? (
                  <button type="button" onClick={() => onFocus(e.x!, e.y!)}>
                    {body}
                  </button>
                ) : (
                  <div className="ev-static">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function CivPanel() {
  const towns = useWorldMirror((s) => s.towns);
  const population = useWorldMirror((s) => s.population);
  return (
    <section className="panel" aria-labelledby="civ-title">
      <h2 id="civ-title">{t('panel.civ')}</h2>
      <dl className="kv">
        <dt>{t('civ.count')}</dt>
        <dd>{towns.reduce((a, b) => a + b, 0)}</dd>
        <dt>{t('civ.pop')}</dt>
        <dd>{Math.round(population).toLocaleString('ja-JP')}</dd>
        <dt>{t('civ.tiers')}</dt>
        <dd>{towns.join(' / ')}</dd>
      </dl>
    </section>
  );
}
