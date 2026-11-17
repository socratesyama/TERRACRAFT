/** 文字列はキー管理（日本語が標準、英語は後から追加できる形: 計画書 §13.5） */
const ja = {
  'app.title': 'TERRA CRAFT',
  'app.tagline': '地形が違うだけで、こんなにも世界が変わる',
  'play.play': '再生',
  'play.pause': '一時停止',
  'play.speed': '再生速度',
  'status.tick': '経過年',
  'status.worker.connecting': 'シミュレーション起動中',
  'status.worker.ready': 'シミュレーション稼働中',
  'status.worker.error': 'エラー',
  'status.degraded': '高速モード',
  'error.data': 'データの検証に失敗しました',
  'error.webgl': '3D表示を初期化できませんでした',
  'panel.stats': '統計',
  'panel.layers': 'レイヤー',
  'panel.layers.soon': '気温・水分・侵食は後のマイルストーンで使えます',
  'panel.scenario': '地形プリセット',
  'legend.precip': '年降水量',
  'legend.dry': '乾燥',
  'legend.wet': '湿潤',
  'layer.terrain': '地形',
  'layer.precip': '降水',
  'layer.temperature': '気温',
  'layer.moisture': '水分',
  'layer.erosion': '侵食',
  'stats.seed': 'シード',
  'stats.grid': 'グリッド',
  'stats.cell': '1セル',
  'stats.tickCost': '1 tick の計算時間',
  'stats.tickBudget': '予算',
} as const;

export type MessageKey = keyof typeof ja;

const dictionaries = { ja } as const;
type Locale = keyof typeof dictionaries;

let locale: Locale = 'ja';

export function t(key: MessageKey): string {
  return dictionaries[locale][key];
}

export function setLocale(next: Locale): void {
  locale = next;
}
