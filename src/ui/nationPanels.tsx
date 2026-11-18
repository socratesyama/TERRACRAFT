import type { CSSProperties } from 'react';
import type { DataBundle } from '../core/data/schema';
import type { Op } from '../worker/protocol';
import { DI_JA, MODE_JA, PERSONALITY_JA, RES_JA, STATUS_JA, t } from './i18n';
import { useUiStore, useWorldMirror } from './store';

type Send = (op: Op) => void;

const PLAYER = 1;
const colorOf = (data: DataBundle, id: number): string => data.nations.setup.colors[id - 1] ?? '#888888';
const nameOf = (data: DataBundle, id: number): string => data.nations.setup.names[id - 1] ?? `国${id}`;
const nationStyle = (data: DataBundle, id: number): CSSProperties => ({ ['--nation' as string]: colorOf(data, id) });

/** 発展度の推移（折れ線）。色だけでなく凡例（国名の行）で区別する */
function Spark({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${36 - (v / 100) * 34}`).join(' ');
  return (
    <svg className="spark" viewBox="0 0 100 36" preserveAspectRatio="none" role="img" aria-label={t('nation.history')}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** 国の順位表と、発展度の内訳（§22.6）。数値はすべて Worker の統計 */
export function NationPanel({ data }: { data: DataBundle }) {
  const nations = useWorldMirror((s) => s.nations);
  if (nations.length === 0) {
    return (
      <section className="panel" aria-labelledby="nation-title">
        <h2 id="nation-title">{t('panel.nations')}</h2>
        <p className="note">{t('nation.off')}</p>
      </section>
    );
  }
  const ranked = [...nations].sort((a, b) => b.di - a.di || a.id - b.id);
  return (
    <section className="panel" aria-labelledby="nation-title">
      <h2 id="nation-title">{t('panel.nations')}</h2>
      {ranked.map((n, rank) => (
        <div key={n.id} className="nation-row" style={nationStyle(data, n.id)}>
          <h3>
            {rank + 1}. {n.name}
            {n.id === PLAYER ? `（${t('nation.you')}）` : ''}
            <span className="tag">{PERSONALITY_JA[n.personality] ?? n.personality}</span>
          </h3>
          <dl className="kv">
            <dt>{t('nation.di')}</dt>
            <dd>{n.di.toFixed(1)}</dd>
            <dt>{t('nation.pop')}</dt>
            <dd>{Math.round(n.pop).toLocaleString('ja-JP')}</dd>
            <dt>{t('nation.cells')}</dt>
            <dd>{n.cells.toLocaleString('ja-JP')}</dd>
            <dt>{t('nation.army')}</dt>
            <dd>{Math.round(n.army).toLocaleString('ja-JP')}</dd>
            <dt>{t('nation.stock')}</dt>
            <dd>
              {RES_JA.food} {Math.round(n.stock.food)} / {RES_JA.wood} {n.stock.wood.toFixed(1)} / {RES_JA.ore} {n.stock.ore.toFixed(1)} / 富 {Math.round(n.stock.wealth)}
            </dd>
          </dl>
          <div className="di-bars">
            {n.diParts.map((v, i) => (
              <div key={DI_JA[i]} style={{ display: 'contents' }}>
                <span>{DI_JA[i]}</span>
                <span className="bar" role="meter" aria-label={DI_JA[i]} aria-valuemin={0} aria-valuemax={1} aria-valuenow={Number(v.toFixed(2))}>
                  <i style={{ width: `${v * 100}%` }} />
                </span>
              </div>
            ))}
          </div>
          <Spark values={n.diHistory} color={colorOf(data, n.id)} />
        </div>
      ))}
    </section>
  );
}

/** プレイヤー（国 1）から見た外交。提案への返答と、貿易協定・不可侵・贈り物・宣戦 */
export function DiplomacyPanel({ data, send }: { data: DataBundle; send: Send }) {
  const diplo = useWorldMirror((s) => s.diplo);
  const nations = useWorldMirror((s) => s.nations);
  const notice = useUiStore((s) => s.notice);
  if (nations.length === 0) return null;
  const mine = diplo.relations.filter((r) => r.a === PLAYER || r.b === PLAYER);
  const incoming = diplo.proposals.filter((p) => p.to === PLAYER);
  const kind = { trade: t('diplo.proposeTrade'), nonAggression: t('diplo.proposeNonAgg'), peace: t('diplo.peace') } as const;
  const act = (action: 'proposeTrade' | 'proposeNonAggression' | 'gift' | 'declareWar' | 'proposePeace' | 'cancelPact', to: number) =>
    send({ t: 'diplo', tick: 0, action, to });
  return (
    <section className="panel" aria-labelledby="diplo-title">
      <h2 id="diplo-title">{t('panel.diplo')}</h2>
      <h3 className="sub">{t('diplo.proposals')}</h3>
      {incoming.length === 0 && <p className="note">{t('diplo.none')}</p>}
      {incoming.map((p) => (
        <div key={p.id} className="rel-row">
          {nameOf(data, p.from)}: {kind[p.kind]}
          <div className="rel-actions">
            <button type="button" className="choice" onClick={() => send({ t: 'diplo', tick: 0, action: 'respond', proposalId: p.id, accept: true })}>
              {t('diplo.accept')}
            </button>
            <button type="button" className="choice" onClick={() => send({ t: 'diplo', tick: 0, action: 'respond', proposalId: p.id, accept: false })}>
              {t('diplo.decline')}
            </button>
          </div>
        </div>
      ))}
      {mine.map((r) => {
        const other = r.a === PLAYER ? r.b : r.a;
        const pct = ((r.trust + 100) / 200) * 100;
        return (
          <div key={other} className="rel-row" style={nationStyle(data, other)}>
            <strong>{nameOf(data, other)}</strong>
            <span className="tag" data-s={r.status}>{STATUS_JA[r.status]}</span>
            {r.tradePactUntil > 0 && <span className="tag">{t('diplo.pactTrade')}</span>}
            {r.nonAggUntil > 0 && <span className="tag">{t('diplo.pactNonAgg')}</span>}
            <div className="di-bars">
              <span>{t('diplo.trust')} {r.trust.toFixed(0)}</span>
              <span className="bar" role="meter" aria-label={t('diplo.trust')} aria-valuemin={-100} aria-valuemax={100} aria-valuenow={Math.round(r.trust)}>
                <i style={{ width: `${pct}%` }} />
              </span>
            </div>
            <div className="rel-actions">
              {r.status === 'war' ? (
                <button type="button" className="choice" onClick={() => act('proposePeace', other)}>{t('diplo.peace')}</button>
              ) : (
                <>
                  <button type="button" className="choice" onClick={() => act('proposeTrade', other)}>{t('diplo.proposeTrade')}</button>
                  <button type="button" className="choice" onClick={() => act('proposeNonAggression', other)}>{t('diplo.proposeNonAgg')}</button>
                  <button type="button" className="choice" onClick={() => act('gift', other)}>{t('diplo.gift')}</button>
                  {(r.tradePactUntil > 0 || r.nonAggUntil > 0) && (
                    <button type="button" className="choice" onClick={() => act('cancelPact', other)}>{t('diplo.cancel')}</button>
                  )}
                  <button type="button" className="choice" onClick={() => act('declareWar', other)}>{t('diplo.war')}</button>
                </>
              )}
            </div>
          </div>
        );
      })}
      {notice && <p className="notice" role="status">{notice}</p>}
    </section>
  );
}

/** 戦争: 当事者・占領・戦争疲れ・戦争理由・前線の地形による説明（§22.7）。動員の目標スライダー */
export function WarPanel({ data, send }: { data: DataBundle; send: Send }) {
  const wars = useWorldMirror((s) => s.diplo.wars);
  const nations = useWorldMirror((s) => s.nations);
  const tick = useWorldMirror((s) => s.tick);
  if (nations.length === 0) return null;
  const me = nations[PLAYER - 1];
  const target = me ? me.mobTarget : 0.3;
  const limit = data.war.termination.maxDuration.value;
  return (
    <section className="panel" aria-labelledby="war-title">
      <h2 id="war-title">{t('panel.war')}</h2>
      {wars.length === 0 && <p className="note">{t('war.none')}</p>}
      {wars.map((w) => (
        <div key={w.id} className="rel-row">
          <strong style={{ color: colorOf(data, w.a) }}>{nameOf(data, w.a)}</strong> → <strong style={{ color: colorOf(data, w.b) }}>{nameOf(data, w.b)}</strong>
          <span className="tag" data-s="war">{tick - w.startTick} / {limit}</span>
          <dl className="kv">
            <dt>{t('war.casus')}</dt>
            <dd>{w.casus}</dd>
            <dt>{t('war.captured')}</dt>
            <dd>{w.capturedByA} セル</dd>
            <dt>{t('war.weariness')}</dt>
            <dd>
              {w.wearA.toFixed(2)} / {w.wearB.toFixed(2)}
            </dd>
          </dl>
          <p className="note">{w.note}</p>
        </div>
      ))}
      <label className="slider">
        <span>
          {t('war.mobilize')} {(target * 100).toFixed(0)}%
        </span>
        <input type="range" min={0} max={1} step={0.05} value={target} onChange={(e) => send({ t: 'military', tick: 0, mobilization: Number(e.target.value) })} />
      </label>
    </section>
  );
}

/** 直近の貿易の取引（資源・量・価格・輸送手段）と輸送の損失 */
export function TradePanel() {
  const lt = useWorldMirror((s) => s.diplo.lastTrade);
  const nations = useWorldMirror((s) => s.nations);
  if (nations.length === 0) return null;
  return (
    <section className="panel" aria-labelledby="trade-title">
      <h2 id="trade-title">{t('panel.trade')}</h2>
      {lt.flows.length === 0 && <p className="note">{t('trade.none')}</p>}
      <ul className="plain">
        {lt.flows.map((f, i) => (
          <li key={i}>
            {nations[f.from - 1]?.name} → {nations[f.to - 1]?.name}: {RES_JA[f.res]} {f.sent.toFixed(1)}（{MODE_JA[f.mode]}、価格 {f.price.toFixed(2)}）
          </li>
        ))}
      </ul>
      {lt.flows.length > 0 && (
        <p className="note">
          {t('trade.loss')} {lt.loss.toFixed(2)}
        </p>
      )}
    </section>
  );
}
