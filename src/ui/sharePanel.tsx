import { useEffect } from 'react';
import type { DataBundle } from '../core/data/schema';
import { ShareError, type ShareState } from '../core/share';
import type { SimulationClient } from '../worker/client';
import { t } from './i18n';
import { buildShareHash, parseShareHash } from './shareUrl';
import { useUiStore, useWorldMirror } from './store';

interface Props {
  data: DataBundle;
  client: () => SimulationClient | null;
  /** 読み込む状態を App に渡す（App が Worker を作り直す） */
  onLoad: (st: ShareState, fastForward: boolean) => void;
  onScreenshot: () => void;
}

/** 現在の入力（Worker から取る）。共有・自動保存・JSON 書き出しで使う */
function requestState(c: SimulationClient): Promise<{ st: ShareState; exact: boolean }> {
  return new Promise((resolve) => {
    const prev = c.onState;
    c.onState = (m) => {
      c.onState = prev;
      resolve({ st: { scenarioId: m.scenarioId, seed: m.seed, size: m.size, nations: m.nations, ops: m.ops, tick: m.tick }, exact: m.exact });
    };
    c.send({ type: 'exportState' });
  });
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 保存できない環境（プライベートウィンドウなど）では何もしない
  }
}
function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 起動時に #w= を読む。読めなければわかりやすいエラーを出して初期状態のまま */
export function useShareBoot(data: DataBundle): void {
  useEffect(() => {
    void (async () => {
      try {
        const st = await parseShareHash(data, window.location.hash);
        if (st) useUiStore.getState().setShareOffer(st);
      } catch (e) {
        useUiStore.getState().setShareMessage(`${t('share.loadError')}：${e instanceof ShareError ? e.message : String(e)}`);
      }
    })();
  }, [data]);
}

export function SharePanel({ data, client, onLoad, onScreenshot }: Props) {
  const offer = useUiStore((s) => s.shareOffer);
  const msg = useUiStore((s) => s.shareMessage);
  const progress = useUiStore((s) => s.replayProgress);
  const set = useUiStore.getState();
  const auto = data.runtime.share.autosave;
  const saved = load(auto.storageKey);

  const copy = async (): Promise<void> => {
    const c = client();
    if (!c) return;
    const { st, exact } = await requestState(c);
    const r = await buildShareHash(data, st);
    if (r.tooLong) {
      set.setShareMessage(`${t('share.tooLong')}（${r.chars} ${t('share.chars')}）`);
      return;
    }
    history.replaceState(null, '', r.hash);
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      // クリップボードが使えなくても、アドレスバーの URL をコピーできる
    }
    set.setShareMessage(`${t('share.copied')}（${r.chars} ${t('share.chars')}）${r.warn ? `　${t('share.warn')}` : ''}${exact ? '' : `　${t('share.inexact')}`}`);
  };

  const exportJson = async (): Promise<void> => {
    const c = client();
    if (!c) return;
    const { st } = await requestState(c);
    const blob = new Blob([JSON.stringify(st)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'terracraft.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = (file: File | undefined): void => {
    if (!file) return;
    void file.text().then((txt) => {
      try {
        const st = JSON.parse(txt) as ShareState;
        if (!st || typeof st.scenarioId !== 'string' || !Array.isArray(st.ops)) throw new ShareError('形式が違います');
        set.setShareOffer(st);
      } catch (e) {
        set.setShareMessage(`${t('share.loadError')}：${e instanceof Error ? e.message : String(e)}`);
      }
    });
  };

  return (
    <section className="panel" aria-labelledby="share-title">
      <h2 id="share-title">{t('panel.share')}</h2>
      {offer && (
        <div className="notice" role="group" aria-label={t('share.offerTitle')}>
          <p>{t('share.offerTitle')}（時間 {offer.tick}）</p>
          <div className="choices">
            <button type="button" className="choice" onClick={() => { onLoad(offer, false); set.setShareOffer(null); }}>{t('share.blueprint')}</button>
            {offer.tick > 0 && (
              <button type="button" className="choice active" onClick={() => { onLoad(offer, true); set.setShareOffer(null); }}>{t('share.current')}</button>
            )}
          </div>
        </div>
      )}
      {progress !== null && (
        <p role="status">
          {t('share.replaying')} {Math.round(progress * 100)}%
        </p>
      )}
      <div className="choices">
        <button type="button" className="choice" onClick={() => void copy()}>{t('share.copy')}</button>
        <button type="button" className="choice" onClick={onScreenshot}>{t('share.screenshot')}</button>
        <button type="button" className="choice" onClick={() => void exportJson()}>{t('share.json')}</button>
        <label className="choice">
          {t('share.loadJson')}
          <input type="file" accept="application/json" hidden onChange={(e) => importJson(e.target.files?.[0])} />
        </label>
        {saved && !offer && (
          <button
            type="button"
            className="choice"
            onClick={() => {
              try {
                set.setShareOffer(JSON.parse(saved) as ShareState);
              } catch {
                set.setShareMessage(t('share.loadError'));
              }
            }}
          >
            {t('share.autosaveLoad')}
          </button>
        )}
      </div>
      {msg && <p className="notice" role="status">{msg}</p>}
    </section>
  );
}

/** 自動保存（localStorage、デバウンス）。tick か Op が変わったら、debounceMs 後に最新を 1 つ保存する */
export function useAutosave(data: DataBundle, client: () => SimulationClient | null): void {
  const tick = useWorldTick();
  useEffect(() => {
    const id = window.setTimeout(() => {
      const c = client();
      if (!c) return;
      void requestState(c).then(({ st }) => save(data.runtime.share.autosave.storageKey, JSON.stringify(st)));
    }, data.runtime.share.autosave.debounceMs);
    return () => window.clearTimeout(id);
  }, [tick, data, client]);
}

function useWorldTick(): number {
  return useWorldMirror((s) => s.tick);
}
