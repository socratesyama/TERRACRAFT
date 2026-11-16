import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DataError, loadData } from './core/data/loader';
import { App } from './ui/App';
import { t } from './ui/i18n';
import './ui/app.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root が見つかりません');
const root = createRoot(rootEl);

try {
  const { data, warnings } = loadData();
  for (const w of warnings) console.warn(`[data] ${w.message}`);
  root.render(
    <StrictMode>
      <App data={data} />
    </StrictMode>,
  );
} catch (e) {
  // data/ の検証失敗は、原因を画面に出して止める（黙って壊れた世界を動かさない）
  const message = e instanceof DataError ? e.message : String(e);
  root.render(
    <div className="fatal">
      <h1>{t('error.data')}</h1>
      <pre>{message}</pre>
    </div>,
  );
}
