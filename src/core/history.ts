import type { CivState, DiploState, Nation, DerivedFields, PrimaryFields, Settlement, World, WorldEvent, WorldParams } from './world';

type TypedArray = Float32Array | Uint8Array | Int32Array | Uint32Array | Uint16Array;

/** Undo 用の完全な複製（§9.3）。派生配列も含めるので、戻したあとの再計算は不要（戻した結果が元と完全に一致する）。 */
export interface WorldSnapshot {
  tick: number;
  params: WorldParams;
  primary: Record<string, TypedArray>;
  derived: Record<string, TypedArray>;
  settlements: Settlement[];
  civ: CivState;
  nations: Nation[];
  diplo: DiploState;
  events: WorldEvent[];
  floodReached: number;
  dirty: number;
}

function cloneArrays(src: PrimaryFields | DerivedFields): Record<string, TypedArray> {
  const out: Record<string, TypedArray> = {};
  for (const [k, v] of Object.entries(src)) out[k] = (v as TypedArray).slice();
  return out;
}

function restoreArrays(dst: PrimaryFields | DerivedFields, src: Record<string, TypedArray>): void {
  for (const [k, v] of Object.entries(src)) (dst as unknown as Record<string, TypedArray>)[k]!.set(v as never);
}

export function snapshotWorld(w: World): WorldSnapshot {
  return {
    tick: w.tick,
    params: { ...w.params },
    primary: cloneArrays(w.primary),
    derived: cloneArrays(w.derived),
    settlements: w.settlements.map((s) => ({ ...s })),
    civ: structuredClone(w.civ),
    nations: structuredClone(w.nations),
    diplo: structuredClone(w.diplo),
    events: w.events.map((e) => ({ ...e })),
    floodReached: w.floodReached,
    dirty: w.dirty,
  };
}

export function restoreWorld(w: World, s: WorldSnapshot): void {
  w.tick = s.tick;
  Object.assign(w.params, s.params);
  restoreArrays(w.primary, s.primary);
  restoreArrays(w.derived, s.derived);
  w.settlements = s.settlements.map((c) => ({ ...c }));
  w.civ = structuredClone(s.civ);
  w.nations = structuredClone(s.nations);
  w.diplo = structuredClone(s.diplo);
  w.events = s.events.map((e) => ({ ...e }));
  w.floodReached = s.floodReached;
  w.dirty = s.dirty;
}
