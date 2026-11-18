import type { DataBundle } from './data/schema';
import type { DiploOp } from './nations/diplomacy';
import type { ContourStroke, Op, ParamKey } from './ops';

/**
 * URL 共有（計画書 §14）。世界の配列は保存せず、世界を再現する入力だけを持つ。
 * 数値（倍率・上限・版）はすべて data/runtime.json の share から読む。
 * 圧縮と base64url は UI 側（src/ui/shareUrl.ts）。ここは純関数で、Node でもテストできる。
 */
export interface ShareState {
  scenarioId: string;
  seed: number;
  size: number;
  nations: boolean;
  ops: Op[];
  /** 共有した時点の tick（「現在の時点」で開くときの早送り先） */
  tick: number;
}

export class ShareError extends Error {}

const PARAM_KEYS: ParamKey[] = ['seaLevel', 'edgeMode', 'rainfallScale', 'temperatureBias', 'windDir', 'peaceMode'];
const DIPLO_ACTIONS = ['proposeTrade', 'proposeNonAggression', 'gift', 'declareWar', 'proposePeace', 'cancelPact', 'embargo', 'liftEmbargo', 'sabotage', 'respond'] as const;
const KIND = { contour: 0, raise: 1, forest: 2, dam: 3, fill: 4, param: 5, rain: 6, diplo: 7, military: 8 } as const;

/** Op の小数を共有形式の精度に丸める。操作の適用時にも使うので、共有 → 復元で世界が一致する */
export function quantizeValue(data: DataBundle, v: number): number {
  const s = data.runtime.share.opScale.value;
  return Math.round(v * s) / s;
}

export function quantizeOp(data: DataBundle, op: Op): Op {
  const f = (v: number): number => quantizeValue(data, v);
  const fs = (a: number[]): number[] => a.map(f);
  switch (op.t) {
    case 'contour':
      return { ...op, stroke: { ...op.stroke, points: fs(op.stroke.points), elevation: f(op.stroke.elevation), width: f(op.stroke.width) } };
    case 'raise':
    case 'forest':
      return { ...op, pts: fs(op.pts), r: f(op.r), amount: f(op.amount) };
    case 'fill':
      return { ...op, pts: fs(op.pts), r: f(op.r) };
    case 'dam':
      return { ...op, a: [f(op.a[0]), f(op.a[1])], b: [f(op.b[0]), f(op.b[1])], crest: f(op.crest) };
    case 'param':
      return { ...op, value: f(op.value) };
    case 'rain':
      return { ...op, amount: f(op.amount) };
    case 'military':
      return { ...op, mobilization: f(op.mobilization) };
    default:
      return op;
  }
}

// ---- バイト列の読み書き（可変長整数・zigzag）----

class Writer {
  readonly bytes: number[] = [];
  u8(v: number): void {
    this.bytes.push(v & 255);
  }
  uv(v: number): void {
    if (!Number.isInteger(v) || v < 0) throw new ShareError(`符号化できない値: ${v}`);
    let x = v;
    while (x >= 128) {
      this.bytes.push((x % 128) | 128);
      x = Math.floor(x / 128);
    }
    this.bytes.push(x);
  }
  sv(v: number): void {
    this.uv(v < 0 ? -2 * v - 1 : 2 * v);
  }
}

class Reader {
  pos = 0;
  constructor(private readonly b: Uint8Array, private readonly end: number) {}
  u8(): number {
    if (this.pos >= this.end) throw new ShareError('URL のデータが途中で切れています');
    return this.b[this.pos++]!;
  }
  uv(): number {
    let v = 0;
    let mul = 1;
    for (let i = 0; i < 9; i++) {
      const c = this.u8();
      v += (c & 127) * mul;
      if (c < 128) return v;
      mul *= 128;
    }
    throw new ShareError('URL のデータが壊れています');
  }
  sv(): number {
    const z = this.uv();
    return z % 2 === 1 ? -(z + 1) / 2 : z / 2;
  }
  get done(): boolean {
    return this.pos >= this.end;
  }
}

export function crc16(bytes: ArrayLike<number>, len = bytes.length): number {
  let crc = 0xffff;
  for (let i = 0; i < len; i++) {
    crc ^= (bytes[i]! & 255) << 8;
    for (let k = 0; k < 8; k++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

function writePoints(w: Writer, pts: number[], s: number): void {
  w.uv(pts.length / 2);
  let px = 0;
  let py = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const x = Math.round(pts[i]! * s);
    const y = Math.round(pts[i + 1]! * s);
    w.sv(x - px); // 最初の点は原点からの差分 ＝ 絶対値。以降は前の点との差分
    w.sv(y - py);
    px = x;
    py = y;
  }
}

function readPoints(r: Reader, s: number): number[] {
  const n = r.uv();
  if (n > 100000) throw new ShareError('点列が大きすぎます');
  const out: number[] = [];
  let px = 0;
  let py = 0;
  for (let i = 0; i < n; i++) {
    px += r.sv();
    py += r.sv();
    out.push(px / s, py / s);
  }
  return out;
}

/** 状態 → 無圧縮のバイト列（版・内容・CRC16） */
export function encodeState(data: DataBundle, st: ShareState): Uint8Array {
  const sh = data.runtime.share;
  const s = sh.opScale.value;
  const sizes = data.scale.grid.sizes as number[];
  const scenarios = Object.keys(data.scenarios.scenarios);
  const si = scenarios.indexOf(st.scenarioId);
  const zi = sizes.indexOf(st.size);
  if (si < 0) throw new ShareError(`未知のシナリオ: ${st.scenarioId}`);
  if (zi < 0) throw new ShareError(`未対応のサイズ: ${st.size}`);
  const w = new Writer();
  w.u8(sh.formatVersion);
  w.uv(st.seed >>> 0);
  w.u8(zi);
  w.u8(si);
  w.u8(st.nations ? 1 : 0);
  w.uv(st.tick);
  w.uv(st.ops.length);
  const f = (v: number): void => w.sv(Math.round(v * s));
  let prev = 0;
  for (const raw of st.ops) {
    const op = raw;
    if (op.tick < prev) throw new ShareError('Op の tick が昇順になっていません');
    w.u8(KIND[op.t]);
    w.uv(op.tick - prev);
    prev = op.tick;
    switch (op.t) {
      case 'contour':
        f(op.stroke.elevation);
        f(op.stroke.width);
        writePoints(w, op.stroke.points, s);
        break;
      case 'raise':
      case 'forest':
        f(op.r);
        f(op.amount);
        writePoints(w, op.pts, s);
        break;
      case 'fill':
        f(op.r);
        writePoints(w, op.pts, s);
        break;
      case 'dam':
        writePoints(w, [op.a[0], op.a[1], op.b[0], op.b[1]], s);
        f(op.crest);
        break;
      case 'param': {
        const k = PARAM_KEYS.indexOf(op.key);
        if (k < 0) throw new ShareError(`未知のパラメータ: ${op.key}`);
        w.u8(k);
        f(op.value);
        break;
      }
      case 'rain':
        f(op.amount);
        break;
      case 'military':
        f(op.mobilization);
        break;
      case 'diplo': {
        const a = DIPLO_ACTIONS.indexOf(op.action);
        w.u8(a);
        if (op.action === 'respond') {
          w.uv(op.proposalId);
          w.u8(op.accept ? 1 : 0);
        } else w.uv(op.to);
        break;
      }
    }
  }
  const crc = crc16(w.bytes);
  w.u8(crc >> 8);
  w.u8(crc);
  return Uint8Array.from(w.bytes);
}

/** バイト列 → 状態。壊れていれば ShareError（わかりやすい日本語） */
export function decodeState(data: DataBundle, bytes: Uint8Array): ShareState {
  const sh = data.runtime.share;
  const s = sh.opScale.value;
  if (bytes.length < 6) throw new ShareError('URL のデータが短すぎます');
  const body = bytes.length - 2;
  if (crc16(bytes, body) !== ((bytes[body]! << 8) | bytes[body + 1]!)) throw new ShareError('URL のデータが壊れています（検査値が合いません）');
  const r = new Reader(bytes, body);
  const ver = r.u8();
  if (ver !== sh.formatVersion) throw new ShareError(`この URL は新しい形式（v${ver}）です。アプリを更新してください`);
  const seed = r.uv();
  const sizes = data.scale.grid.sizes as number[];
  const scenarios = Object.keys(data.scenarios.scenarios);
  const size = sizes[r.u8()];
  const scenarioId = scenarios[r.u8()];
  if (size === undefined || scenarioId === undefined) throw new ShareError('URL のシナリオまたはサイズが不明です');
  const nations = r.u8() === 1;
  const tick = r.uv();
  const count = r.uv();
  if (count > 100000) throw new ShareError('Op の数が多すぎます');
  const f = (): number => r.sv() / s;
  const ops: Op[] = [];
  let t = 0;
  for (let i = 0; i < count; i++) {
    const kind = r.u8();
    t += r.uv();
    switch (kind) {
      case KIND.contour: {
        const elevation = f();
        const width = f();
        const points = readPoints(r, s);
        const stroke: ContourStroke = { points, elevation, width };
        ops.push({ t: 'contour', tick: t, stroke });
        break;
      }
      case KIND.raise:
      case KIND.forest: {
        const rad = f();
        const amount = f();
        const pts = readPoints(r, s);
        ops.push({ t: kind === KIND.raise ? 'raise' : 'forest', tick: t, pts, r: rad, amount });
        break;
      }
      case KIND.fill: {
        const rad = f();
        ops.push({ t: 'fill', tick: t, pts: readPoints(r, s), r: rad });
        break;
      }
      case KIND.dam: {
        const p = readPoints(r, s);
        if (p.length !== 4) throw new ShareError('ダムの座標が不正です');
        ops.push({ t: 'dam', tick: t, a: [p[0]!, p[1]!], b: [p[2]!, p[3]!], crest: f() });
        break;
      }
      case KIND.param: {
        const key = PARAM_KEYS[r.u8()];
        if (!key) throw new ShareError('未知のパラメータです');
        ops.push({ t: 'param', tick: t, key, value: f() });
        break;
      }
      case KIND.rain:
        ops.push({ t: 'rain', tick: t, amount: f() });
        break;
      case KIND.military:
        ops.push({ t: 'military', tick: t, mobilization: f() });
        break;
      case KIND.diplo: {
        const action = DIPLO_ACTIONS[r.u8()];
        if (!action) throw new ShareError('未知の外交操作です');
        if (action === 'respond') {
          const proposalId = r.uv();
          ops.push({ t: 'diplo', tick: t, action, proposalId, accept: r.u8() === 1 } as DiploOp);
        } else ops.push({ t: 'diplo', tick: t, action, to: r.uv() } as DiploOp);
        break;
      }
      default:
        throw new ShareError('未知の操作の種類です');
    }
  }
  if (!r.done) throw new ShareError('URL のデータに余りがあります');
  return { scenarioId, seed, size, nations, ops, tick };
}

// ---- base64url ----
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function toBase64Url(b: Uint8Array): string {
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i]! << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
    if (i + 1 < b.length) out += B64[(n >> 6) & 63]!;
    if (i + 2 < b.length) out += B64[n & 63]!;
  }
  return out;
}

export function fromBase64Url(s: string): Uint8Array {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new ShareError('URL に使えない文字が含まれています');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 255);
      acc &= (1 << bits) - 1;
    }
  }
  return Uint8Array.from(out);
}
