import type { DataBundle } from '../core/data/schema';
import type { Op } from '../core/ops';

/** デモの手順 1 行（data/runtime.json demo.steps）。数値と文言はデータ側にあり、ここには手順を書かない */
export interface DemoStep {
  atMs: number;
  do: 'scenario' | 'layer' | 'tool' | 'caption' | 'op' | 'play' | 'pause' | 'speed' | 'end';
  value?: string | number;
  text?: string;
  op?: Record<string, unknown>;
}

/** デモが画面・Worker を動かすための口。UI 側で実装し、テストでは記録用の偽物を渡す */
export interface DemoHost {
  scenario(id: string): void;
  layer(id: string): void;
  tool(id: string): void;
  caption(text: string | null): void;
  op(op: Op): void;
  play(): void;
  pause(): void;
  speed(v: number): void;
  end(): void;
}

export interface Scheduler {
  after(ms: number, fn: () => void): () => void;
}

export const realScheduler: Scheduler = {
  after(ms, fn) {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
};

export function demoSteps(data: DataBundle): DemoStep[] {
  return (data.runtime as unknown as { demo: { steps: DemoStep[] } }).demo.steps;
}

/** デモの再生。返り値の関数で中断できる（中断しても世界はそのまま残り、そこから触れる） */
export function runDemo(data: DataBundle, host: DemoHost, sched: Scheduler = realScheduler): () => void {
  const steps = demoSteps(data);
  const cancels: (() => void)[] = [];
  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    host.caption(null);
    host.end();
  };
  for (const s of steps) {
    cancels.push(
      sched.after(s.atMs, () => {
        switch (s.do) {
          case 'scenario':
            host.scenario(String(s.value));
            break;
          case 'layer':
            host.layer(String(s.value));
            break;
          case 'tool':
            host.tool(String(s.value));
            break;
          case 'caption':
            host.caption(s.text ?? null);
            break;
          case 'op':
            if (s.op) host.op({ ...s.op, tick: 0 } as Op);
            break;
          case 'play':
            host.play();
            break;
          case 'pause':
            host.pause();
            break;
          case 'speed':
            host.speed(Number(s.value));
            break;
          case 'end':
            finish();
            break;
        }
      }),
    );
  }
  return () => {
    for (const c of cancels) c();
    host.pause();
    finish();
  };
}
