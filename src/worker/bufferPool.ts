/**
 * 固定サイズの ArrayBuffer プール（計画書 §11）。
 * Worker が acquire → 中身を書いて transfer → メインが描画後に release で返却 → 再利用。
 * 空のときは undefined を返す。これがバックプレッシャー（返却されるまで次を送らない）になる。
 */
export class BufferPool {
  private readonly free: ArrayBuffer[] = [];
  private outstanding = 0;

  constructor(
    readonly byteLength: number,
    readonly capacity: number,
  ) {
    for (let i = 0; i < capacity; i++) this.free.push(new ArrayBuffer(byteLength));
  }

  acquire(): ArrayBuffer | undefined {
    const b = this.free.pop();
    if (b) this.outstanding++;
    return b;
  }

  /** 返却。サイズが違う・転送済み（byteLength 0）・上限超過のバッファは捨てる */
  release(buf: ArrayBuffer): boolean {
    if (buf.byteLength !== this.byteLength) return false;
    if (this.free.length >= this.capacity) return false;
    this.free.push(buf);
    this.outstanding = Math.max(0, this.outstanding - 1);
    return true;
  }

  /** 貸し出せるバッファの本数 */
  get available(): number {
    return this.free.length;
  }

  get inFlight(): number {
    return this.outstanding;
  }
}
