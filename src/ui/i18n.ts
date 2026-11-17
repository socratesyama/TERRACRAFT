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
  'panel.layers.soon': '侵食は後のマイルストーンで使えます',
  'panel.scenario': '地形プリセット',
  'legend.precip': '年降水量',
  'legend.cold': '寒',
  'legend.hot': '暑',
  'legend.moisture': '水分',
  'legend.vegetation': '植生密度',
  'legend.bare': '裸地',
  'legend.dense': '密',
  'stats.vegetation': '陸の平均植生',
  'panel.biomes': 'バイオームの割合',
  'panel.dev': '開発者向け',
  'dev.rainfall': '降水倍率',
  'legend.dry': '乾燥',
  'legend.wet': '湿潤',
  'layer.terrain': '地形',
  'layer.precip': '降水',
  'layer.temperature': '気温',
  'layer.biome': 'バイオーム',
  'layer.vegetation': '植生',
  'layer.flood': '洪水リスク',
  'panel.tools': '干渉ツール',
  'tool.view': '見る',
  'tool.mountain': '盛り土',
  'tool.dig': '山削り',
  'tool.afforest': '植林',
  'tool.deforest': '伐採',
  'tool.dam': 'ダム',
  'tool.fill': '埋め立て',
  'tool.rain': '豪雨',
  'tool.undo': '元に戻す',
  'tool.redo': 'やり直す',
  'tool.radius': 'ブラシの大きさ',
  'tool.crest': 'ダムの高さ',
  'tool.hint.view': 'ドラッグで回転、ホイールで拡大・縮小',
  'tool.hint.paint': '地形をなぞって変える（1 回のドラッグ = 1 操作）',
  'tool.hint.dam': '谷の一方の壁から他方の壁までドラッグ。青く光る所が新しい湖になる',
  'panel.events': 'できごと',
  'events.empty': 'まだ何も起きていません',
  'events.cause': '原因の操作',
  'panel.civ': '集落',
  'civ.count': '集落の数',
  'civ.pop': '総人口',
  'civ.tiers': '村 / 町 / 都市 / 港町',
  'layer.moisture': '水分',
  'layer.erosion': '侵食',
  'stats.seed': 'シード',
  'stats.grid': 'グリッド',
  'stats.cell': '1セル',
  'stats.tickCost': '1 tick の計算時間',
  'stats.tickBudget': '予算',
} as const;

/** バイオームの表示名（キーは data/ecology-biomes.json と特別区分 water/snow/coast/wetland） */
const biomeNames: Readonly<Record<string, string>> = {
  water: '水域',
  snow: '高山（雪）',
  coast: '海岸',
  wetland: '湿地',
  tundra: 'ツンドラ',
  boreal: '亜寒帯林',
  temperateRainforest: '温帯雨林',
  temperateForest: '温帯林',
  temperateGrassland: '温帯草原',
  desert: '砂漠',
  savanna: 'サバンナ',
  tropicalSeasonalForest: '熱帯季節林',
  tropicalRainforest: '熱帯雨林',
};

export function biomeLabel(key: string): string {
  return biomeNames[key] ?? key;
}

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
