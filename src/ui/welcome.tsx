import { t } from './i18n';
import { useUiStore } from './store';

/** 初回の入口（§13.4）。審査員・初めての人が、描かなくても結果を見られる */
export function Welcome({ onDemo, onClose }: { onDemo: () => void; onClose: () => void }) {
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
          <button type="button" className="choice" onClick={onClose}>
            {t('welcome.blank')}
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
