import type { DataBundle } from '../core/data/schema';
import { t } from './i18n';
import { TOOLS } from './panels';
import { useUiStore, useWorldMirror } from './store';

/** 狭い画面で常に見える道具列（3D 表示の上端）。ツール・雨・元に戻す。CSS で狭い画面だけ表示する */
export function QuickBar({ data, onUndo, onRain }: { data: DataBundle; onUndo: () => void; onRain: () => void }) {
  const tool = useUiStore((s) => s.tool);
  const setTool = useUiStore((s) => s.setTool);
  const undoDepth = useWorldMirror((s) => s.undoDepth);
  const rain = data.runtime.ui.tools.rainAmount.value;
  return (
    <div className="quickbar" role="toolbar" aria-label={t('panel.tools')}>
      {TOOLS.map(({ id, label }) => (
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
