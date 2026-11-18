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
  'layer.nation': '領土',
  'layer.defense': '防御地形',
  'legend.defense': '守りやすさ',
  'legend.defense.low': '平野 ×1',
  'legend.defense.high': '山・市街 ×2以上',
  'scenario.nationMode': '国家モード（国・外交・戦争）',
  'dev.peace': '平和モード（戦争が起きない）',
  'panel.nations': '国の発展度',
  'nation.rank': '順位',
  'nation.pop': '人口',
  'nation.cells': '領土',
  'nation.army': '軍',
  'nation.stock': '備蓄',
  'nation.di': '発展度',
  'nation.you': 'あなた',
  'nation.off': '国家モードをオンにすると表示されます',
  'nation.history': '発展度の推移',
  'panel.diplo': '外交',
  'diplo.trust': '信頼',
  'diplo.proposeTrade': '貿易協定',
  'diplo.proposeNonAgg': '不可侵',
  'diplo.gift': '贈り物',
  'diplo.war': '宣戦',
  'diplo.peace': '講和を提案',
  'diplo.cancel': '協定を破棄',
  'diplo.accept': '受ける',
  'diplo.decline': '断る',
  'diplo.proposals': '届いている提案',
  'diplo.none': '提案はありません',
  'diplo.pactTrade': '貿易協定',
  'diplo.pactNonAgg': '不可侵',
  'diplo.border': '国境',
  'panel.war': '戦争',
  'war.none': '戦争は起きていません',
  'war.mobilize': '動員の目標',
  'war.captured': '占領',
  'war.weariness': '戦争疲れ',
  'war.casus': '戦争理由',
  'panel.trade': '貿易',
  'trade.none': 'まだ取引はありません',
  'trade.loss': '輸送での損失',
} as const;

/** バイオームの表示名（キーは data/ecology-biomes.json と特別区分 water/snow/coast/wetland） */
export const STATUS_JA: Readonly<Record<string, string>> = { peace: '平和', tension: '緊張', war: '戦争', truce: '休戦' };
export const PERSONALITY_JA: Readonly<Record<string, string>> = {
  player: 'プレイヤー',
  expansionist: '拡張主義',
  conservationist: '自然保護',
  mercantile: '商業重視',
  cautious: '慎重',
};
export const RES_JA: Readonly<Record<string, string>> = { food: '食料', wood: '木材', ore: '鉱石' };
export const MODE_JA: Readonly<Record<string, string>> = { road: '陸路', riverDown: '川下り', riverUp: '川上り', sea: '海路' };
export const DI_JA = ['人口', '食料', '経済', 'インフラ', '環境', '災害への強さ', '技術', '外交'] as const;

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
