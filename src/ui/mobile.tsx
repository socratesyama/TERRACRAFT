import type { DataBundle } from '../core/data/schema';
import { t } from './i18n';
import { TOOLS } from './panels';
import { useUiStore, useWorldMirror } from './store';

/** 狭い画面で常に見える道具列（3D 表示の上端）。ツール・雨・元に戻す。CSS で狭い画面だけ表示する */
export function QuickBar({ data, onUndo, onRain }: { data: DataBundle; onUndo: () => void; onRain: () => void }) {
  const contourMode = useUiStore((s) => s.contourMode);
  const tool = useUiStore((s) => s.tool);
  const setTool = useUiStore((s) => s.setTool);
  const undoDepth = useWorldMirror((s) => s.undoDepth);
  const rain = data.runtime.ui.tools.rainAmount.value;
  if (contourMode) return null; // 描いている間は ContourBar を出す
  return (
    <div className="quickbar" role="toolbar" aria-label={t('panel.tools')}>
      {TOOLS.filter((x) => x.id !== 'contour').map(({ id, label }) => (
        <button key={id} type="button" aria-pressed={tool === id} className={tool === id ? 'choice active' : 'choice'} onClick={() => setTool(id)}>
          {t(label)}
        </button>
      ))}
      <button type="button" className="choice" onClick={onRain} data-rain={rain}>
        {t('tool.rain')}
      </button>
      <button type="button" className="choice" onClick={onUndo} disabled={undoDepth === 0}>
        {t('tool.undo')}
      </button>
    </div>
  );
}

/** 1 行の要約チップ（狭い画面で統計パネルの代わりに、3D 表示の下端に置く） */
export function Chips() {
  const tick = useWorldMirror((s) => s.tick);
  const pop = useWorldMirror((s) => s.population);
  return (
    <p className="chips" role="status">
      <span>
        {t('status.tick')} <strong>{tick}</strong>
      </span>
      <span>
        {t('chip.pop')} <strong>{Math.round(pop).toLocaleString('ja-JP')}</strong>
      </span>
    </p>
  );
}

/** 等高線を描いている間の操作バー（§13.3）: 線の高さ（標高 m 付き）、1 本戻す、完成。最初の 1 本を描くまでは案内を出す（§13.4） */
export function ContourBar({ data }: { data: DataBundle }) {
  const on = useUiStore((s) => s.contourMode);
  const level = useUiStore((s) => s.contourLevel);
  const setLevel = useUiStore((s) => s.setContourLevel);
  const count = useUiStore((s) => s.contours.length);
  const undo = useUiStore((s) => s.undoContour);
  const finish = useUiStore((s) => s.finishContour);
  if (!on) return null;
  const c = (data.runtime.ui as unknown as { contour: { levels: { id: string; label: string; elevation: number }[] } }).contour;
  return (
    <div className="contourbar" role="toolbar" aria-label={t('tool.contour')}>
      <div className="choices" role="radiogroup" aria-label={t('contour.level')}>
        {c.levels.map((l) => (
          <button
            key={l.id}
            type="button"
            role="radio"
            aria-checked={level === l.id}
            className={level === l.id ? 'choice active' : 'choice'}
            onClick={() => setLevel(l.id)}
          >
            {l.label} {Math.round(l.elevation * data.scale.maxElevation.value)} m
          </button>
        ))}
      </div>
      <div className="choices">
        <button type="button" className="choice" onClick={undo} disabled={count === 0}>
          {t('contour.undo')}
        </button>
        <button type="button" className="primary" onClick={finish} disabled={count === 0}>
          {t('contour.finish')}
        </button>
        <span className="note">
          {count} {t('contour.count')}
        </span>
      </div>
      {count === 0 && <p className="hint">{t('contour.hint')}</p>}
    </div>
  );
}
