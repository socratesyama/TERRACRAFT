import type { DataBundle } from '../core/data/schema';
import { decodeState, encodeState, fromBase64Url, ShareError, toBase64Url, type ShareState } from '../core/share';

/**
 * 共有 URL の組み立てと読み取り。形式: `#w=` + base64url（先頭 1 バイトが圧縮方式: 0 = 無圧縮、1 = deflate-raw）。
 * 圧縮は CompressionStream（追加の依存は入れない）。非対応のブラウザでは無圧縮で出す（読むときは両方に対応）。
 * ハッシュ部はサーバーへ送られない。
 */
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(await out);
}

export async function buildShareHash(data: DataBundle, st: ShareState): Promise<{ hash: string; chars: number; tooLong: boolean; warn: boolean }> {
  const raw = encodeState(data, st);
  let method = 0;
  let body = raw;
  if (typeof CompressionStream !== 'undefined') {
    try {
      const z = await pipe(raw, new CompressionStream('deflate-raw'));
      if (z.length < raw.length) {
        method = 1;
        body = z;
      }
    } catch {
      // 無圧縮のまま
    }
  }
  const framed = new Uint8Array(body.length + 1);
  framed[0] = method;
  framed.set(body, 1);
  const hash = `#w=${toBase64Url(framed)}`;
  const sh = data.runtime.share;
  return { hash, chars: hash.length, tooLong: hash.length > sh.maxChars.value, warn: hash.length > sh.softChars.value };
}

export async function parseShareHash(data: DataBundle, hash: string): Promise<ShareState | null> {
  const m = /^#w=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!m) return null;
  const framed = fromBase64Url(m[1]!);
  if (framed.length < 2) throw new ShareError('URL のデータが短すぎます');
  const body = framed.subarray(1);
  let raw: Uint8Array;
  if (framed[0] === 0) raw = body;
  else if (framed[0] === 1) {
    if (typeof DecompressionStream === 'undefined') throw new ShareError('このブラウザは圧縮された URL を読めません');
    try {
      raw = await pipe(body, new DecompressionStream('deflate-raw'));
    } catch {
      throw new ShareError('URL のデータが壊れています（展開できません）');
    }
  } else throw new ShareError('未知の圧縮方式です');
  return decodeState(data, raw);
}
