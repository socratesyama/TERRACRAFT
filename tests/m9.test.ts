import { describe, expect, it } from 'vitest';
import { loadData } from '../src/core/data/loader';
import { runDemo, demoSteps, type DemoHost, type Scheduler } from '../src/ui/demo';
import { SimulationController } from '../src/worker/controller';
import { hashWorld } from '../src/core/world';

const { data } = loadData();

function fake(): { sched: Scheduler; flush: () => void; log: string[]; host: DemoHost; ops: unknown[] } {
  const queue: { at: number; fn: () => void; dead: boolean }[] = [];
  const log: string[] = [];
  const ops: unknown[] = [];
  return {
    sched: {
      after(ms, fn) {
        const q = { at: ms, fn, dead: false };
        queue.push(q);
        return () => (q.dead = true);
      },
    },
    flush: () => queue.sort((a, b) => a.at - b.at).forEach((q) => !q.dead && q.fn()),
    log,
    ops,
    host: {
      scenario: (id) => log.push(`scenario:${id}`),
      layer: (id) => log.push(`layer:${id}`),
      tool: (id) => log.push(`tool:${id}`),
      caption: (t) => log.push(`caption:${t ?? ''}`),
      op: (o) => ops.push(o),
      play: () => log.push('play'),
      pause: () => log.push('pause'),
      speed: (v) => log.push(`speed:${v}`),
      tour: (on) => log.push(`tour:${on}`),
      end: () => log.push('end'),
    },
  };
}

describe('M9 デモ再生', () => {
  const steps = demoSteps(data);
  const layers = ['terrain', 'precip', 'temperature', 'moisture', 'biome', 'vegetation', 'flood', 'nation', 'defense', 'diff', 'erosion'];

  it('手順は時刻順で、約 30 秒、最後は end', () => {
    for (let i = 1; i < steps.length; i++) expect(steps[i]!.atMs).toBeGreaterThanOrEqual(steps[i - 1]!.atMs);
    expect(steps[steps.length - 1]!.do).toBe('end');
    expect(steps[steps.length - 1]!.atMs).toBeGreaterThanOrEqual(25000);
    expect(steps[steps.length - 1]!.atMs).toBeLessThanOrEqual(40000);
  });

  it('レイヤー・速度・シナリオの値がデータとして正しい', () => {
    for (const s of steps) {
      if (s.do === 'layer') expect(layers).toContain(s.value);
      if (s.do === 'speed') expect(data.runtime.playback.speeds).toContain(Number(s.value));
      if (s.do === 'scenario') expect(Object.keys(data.scenarios.scenarios)).toContain(String(s.value));
    }
  });

  it('全部流すと scenario→…→end の順に host が呼ばれ、最後にキャプションが消える', () => {
    const f = fake();
    runDemo(data, f.host, f.sched);
    f.flush();
    expect(f.log[0]).toBe(`scenario:${data.runtime.demo.scenario}`);
    expect(f.log.at(-1)).toBe('end');
    expect(f.log.at(-2)).toBe('caption:');
    expect(f.ops.length).toBeGreaterThan(0);
  });

  it('中断すると、以降の手順は実行されず、止めて終わる', () => {
    const f = fake();
    const stop = runDemo(data, f.host, f.sched);
    stop();
    f.flush();
    expect(f.log).toEqual(['pause', 'tour:false', 'caption:', 'end']);
  });

  it('デモの Op は実際の Worker で適用でき、同じデモは同じ世界になる', () => {
    const run = (): number => {
      let t = 0;
      const c = new SimulationController(data, () => undefined, () => (t += 0.01));
      c.handle({ type: 'init', scenarioId: data.runtime.demo.scenario, seed: data.scenarios.comparison.defaultSeed, size: 128, nations: true });
      for (const s of steps) {
        if (s.do === 'op') c.handle({ type: 'op', op: { ...s.op, tick: 0 } as never });
        if (s.do === 'play' || s.do === 'pause') c.handle({ type: 'step', n: 20 });
      }
      return hashWorld(c.worldRef!, data.runtime.hash.quantizeScale);
    };
    expect(run()).toBe(run());
  });
});
