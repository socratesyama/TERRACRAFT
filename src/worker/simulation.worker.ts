import { loadData } from '../core/data/loader';
import { SimulationController } from './controller';
import type { FromWorker, ToWorker } from './protocol';

interface WorkerScope {
  postMessage(msg: FromWorker, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
}
const ctx = self as unknown as WorkerScope;

let controller: SimulationController;
try {
  const { data } = loadData();
  controller = new SimulationController(
    data,
    (msg, transfer) => ctx.postMessage(msg, transfer),
    () => performance.now(),
  );
} catch (e) {
  ctx.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) }, []);
  throw e;
}

// MessageChannel で自分自身に次のバッチを予約する（setTimeout の最小遅延を避ける）。
const channel = new MessageChannel();
let scheduled = false;
function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  channel.port2.postMessage(0);
}
channel.port1.onmessage = () => {
  scheduled = false;
  const result = controller.runBatch();
  if (result === 'busy') schedule();
  else if (result === 'idle') setTimeout(schedule, 0);
};

ctx.onmessage = (e) => {
  controller.handle(e.data);
  if (controller.isRunning) schedule();
};
