import type { ToolId } from './store';

export type ShortcutAction = { kind: 'togglePlay' } | { kind: 'tool'; tool: ToolId } | { kind: 'undo' } | { kind: 'redo' } | null;

/**
 * キー → 操作（§13.5）: Space = 再生/停止、1〜9 = ツール（並びは ツール一覧）、Ctrl+Z = 元に戻す、Ctrl+Shift+Z / Ctrl+Y = やり直す。
 * 入力欄にいるとき・修飾キー付きの 1〜9 は無視する（ブラウザのタブ切り替えなどを奪わない）。
 */
export function mapKey(
  e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean },
  tools: readonly ToolId[],
  inField: boolean,
): ShortcutAction {
  if (inField) return null;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod) {
    if (k === 'z') return e.shiftKey ? { kind: 'redo' } : { kind: 'undo' };
    if (k === 'y') return { kind: 'redo' };
    return null;
  }
  if (e.altKey) return null;
  if (e.key === ' ') return { kind: 'togglePlay' };
  if (/^[1-9]$/.test(e.key)) {
    const t = tools[Number(e.key) - 1];
    return t ? { kind: 'tool', tool: t } : null;
  }
  return null;
}
