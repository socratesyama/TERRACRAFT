import type { DataBundle } from '../core/data/schema';
import { biomeKeys } from '../core/climate/climate';
import { biomeLabel, t } from './i18n';
import { useUiStore } from './store';

/** 初回の入口（§13.4）。審査員・初めての人が、描かなくても結果を見られる */
export function Welcome({ onDemo, onClose, onDraw }: { onDemo: () => void; onClose: () => void; onDraw: () => void }) {
  const open = useUiStore((s) => s.welcomeOpen);
  if (!open) return null;
  return (
    <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="welcome-card">
        <h2 id="welcome-title">{t('welcome.title')}</h2>
        <p>{t('welcome.lead')}</p>
        <div className="welcome-actions">
          <button type="button" className="primary" onClick={onDemo} autoFocus>
            {t('welcome.demo')}
          </button>
          <button type="button" className="choice" onClick={onClose}>
            {t('welcome.sample')}
          </button>
          <button type="button" className="choice" onClick={onDraw}>
            {t('contour.start')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** デモ中のキャプションと停止ボタン */
export function DemoCaption({ onStop }: { onStop: () => void }) {
  const caption = useUiStore((s) => s.caption);
  const running = useUiStore((s) => s.demoRunning);
  if (!running) return null;
  return (
    <div className="demo-caption">
      <p aria-live="polite">{caption}</p>
      <button type="button" className="choice" onClick={onStop}>
        {t('demo.stop')}
      </button>
    </div>
  );
}

/** セルを指したときの数値（§13.7）。標高は m、気温は °C、水分・植生・洪水リスクは %。画面の端では内側へ寄せる */
export function InspectTooltip({ data }: { data: DataBundle }) {
  const info = useUiStore((s) => s.inspect);
  if (!info) return null;
  const c = info.cell;
  const keys = biomeKeys(data);
  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  const left = Math.min(info.x + 14, window.innerWidth - 190);
  const top = Math.min(info.y + 14, window.innerHeight - 190);
  return (
    <dl className="inspect" style={{ left, top }} aria-live="off">
      <div><dt>{t('inspect.height')}</dt><dd>{Math.round(c.height * data.scale.maxElevation.value)} m</dd></div>
      <div><dt>{t('inspect.biome')}</dt><dd>{biomeLabel(keys[Math.round(c.biome)] ?? 'bare')}</dd></div>
      <div><dt>{t('inspect.temp')}</dt><dd>{c.temperature.toFixed(1)} °C</dd></div>
      <div><dt>{t('inspect.precip')}</dt><dd>{Math.round(c.precip)} mm/年</dd></div>
      <div><dt>{t('inspect.moisture')}</dt><dd>{pct(c.moisture)}</dd></div>
      <div><dt>{t('inspect.veg')}</dt><dd>{pct(c.vegetation)}</dd></div>
      <div><dt>{t('inspect.flood')}</dt><dd>{pct(c.floodRisk)}</dd></div>
      {c.population > 0 && (
        <div><dt>{t('inspect.pop')}</dt><dd>{Math.round(c.population).toLocaleString('ja-JP')}</dd></div>
      )}
    </dl>
  );
}
