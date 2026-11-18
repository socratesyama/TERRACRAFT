/**
 * 地形と水のシェーダ。高さテクスチャ（RGBA32F）: R 標高 / G 水面 / B 川の濃さ / A 降水(mm/年)。
 * 色は表示用の見た目の定数（シミュレーションの数値ではない）。
 * 北は -z、グリッドの y は北向きに増える（uv.y = 1 が北）。
 */

const COMMON = /* glsl */ `
  uniform sampler2D uData;
  uniform float uSize;
  uniform float uHeightScale;
  // 頂点＝セル。補間を避けて、セルの中心を読む（NearestFilter）
  vec2 texelUV(vec2 uv) {
    vec2 cell = floor(uv * (uSize - 1.0) + 0.5);
    return (cell + 0.5) / uSize;
  }
`;

export const TERRAIN_VERTEX = /* glsl */ `
  ${COMMON}
  varying vec2 vTuv;
  void main() {
    vTuv = texelUV(uv);
    vec4 d = texture2D(uData, vTuv);
    vec3 p = position;
    p.y = d.r * uHeightScale;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

export const TERRAIN_FRAGMENT = /* glsl */ `
  ${COMMON}
  uniform sampler2D uData2;
  uniform sampler2D uData3;
  uniform sampler2D uData4;
  uniform sampler2D uData5;
  uniform float uErosionScale;
  uniform sampler2D uPreview;
  uniform vec3 uNation[9];
  uniform vec3 uFront;
  uniform vec3 uFarm;
  uniform vec3 uRoad;
  uniform vec3 uFlood;
  uniform vec3 uPreviewColor;
  uniform float uSeaLevel;
  uniform float uPrecipMax;
  uniform vec2 uTempRange;
  uniform vec3 uBiomeColors[16];
  uniform vec3 uBare;
  uniform int uLayer;
  varying vec2 vTuv;

  // 標高の色（海面からの正規化標高 → 低地の緑 → 茶 → 岩 → 雪）
  vec3 hypsometric(float h) {
    vec3 c0 = vec3(0.77, 0.74, 0.55); // 浜
    vec3 c1 = vec3(0.36, 0.55, 0.32); // 低地
    vec3 c2 = vec3(0.52, 0.47, 0.30); // 丘陵
    vec3 c3 = vec3(0.50, 0.46, 0.43); // 山岳
    vec3 c4 = vec3(0.93, 0.95, 0.97); // 雪
    float t = clamp((h - uSeaLevel) / (1.0 - uSeaLevel), 0.0, 1.0);
    if (t < 0.04) return mix(c0, c1, t / 0.04);
    if (t < 0.35) return mix(c1, c2, (t - 0.04) / 0.31);
    if (t < 0.7) return mix(c2, c3, (t - 0.35) / 0.35);
    return mix(c3, c4, (t - 0.7) / 0.3);
  }

  // 降水の連続色（乾燥=砂色 → 湿潤=青）。色だけに頼らず、凡例は UI 側に置く
  vec3 precipRamp(float t) {
    vec3 a = vec3(0.86, 0.78, 0.55);
    vec3 b = vec3(0.45, 0.72, 0.62);
    vec3 c = vec3(0.12, 0.38, 0.72);
    return t < 0.5 ? mix(a, b, t * 2.0) : mix(b, c, (t - 0.5) * 2.0);
  }

  // 気温: 寒（青）→ 中間（白に近い）→ 暑（赤）
  vec3 tempRamp(float t) {
    vec3 a = vec3(0.17, 0.35, 0.72);
    vec3 b = vec3(0.93, 0.93, 0.85);
    vec3 c = vec3(0.80, 0.25, 0.15);
    return t < 0.5 ? mix(a, b, t * 2.0) : mix(b, c, (t - 0.5) * 2.0);
  }

  vec3 moistRamp(float t) {
    return mix(vec3(0.86, 0.78, 0.55), vec3(0.12, 0.45, 0.50), t);
  }

  void main() {
    vec4 d = texture2D(uData, vTuv);
    vec4 e = texture2D(uData2, vTuv);
    vec4 f = texture2D(uData3, vTuv);
    vec4 g = texture2D(uData4, vTuv);
    vec4 q = texture2D(uData5, vTuv);
    float px = 1.0 / uSize;
    float hE = texture2D(uData, vTuv + vec2(px, 0.0)).r;
    float hW = texture2D(uData, vTuv - vec2(px, 0.0)).r;
    float hN = texture2D(uData, vTuv + vec2(0.0, px)).r;
    float hS = texture2D(uData, vTuv - vec2(0.0, px)).r;
    // 世界の x は東、z は南。グリッドの y は北向き（= -z）
    vec3 n = normalize(vec3(-(hE - hW) * 0.5 * uHeightScale, 1.0, (hN - hS) * 0.5 * uHeightScale));
    vec3 sun = normalize(vec3(-0.6, 0.7, -0.5)); // 北西の上空から
    float shade = 0.42 + 0.58 * max(dot(n, sun), 0.0);

    vec3 base;
    if (uLayer == 1) {
      base = precipRamp(clamp(d.a / uPrecipMax, 0.0, 1.0));
    } else if (uLayer == 2) {
      base = tempRamp(clamp((e.r - uTempRange.x) / (uTempRange.y - uTempRange.x), 0.0, 1.0));
    } else if (uLayer == 3) {
      base = moistRamp(clamp(e.g, 0.0, 1.0));
    } else if (uLayer == 6) {
      base = mix(vec3(0.82, 0.84, 0.80), uFlood, clamp(f.a, 0.0, 1.0));
    } else if (uLayer == 10) {
      // 侵食・堆積: 削れた所は暖色（赤橙）、積もった所は寒色（青緑）。色だけに頼らず、濃さが量を表す
      float v = clamp(q.r / uErosionScale, -1.0, 1.0);
      vec3 ground = hypsometric(max(d.r, uSeaLevel)) * 0.5 + 0.1;
      base = v < 0.0 ? mix(ground, vec3(0.95, 0.42, 0.12), -v) : mix(ground, vec3(0.10, 0.62, 0.78), v);
    } else if (uLayer == 9) {
      // 変化マップ: 直近の操作の前（または「今を基準にする」）からの変化。標高・植生・領有の変化
      base = mix(hypsometric(max(d.r, uSeaLevel)) * 0.55 + 0.08, vec3(1.0, 0.5, 0.1), clamp(g.a * 1.6, 0.0, 1.0));
    } else if (uLayer == 8) {
      // 防御の地形倍率（1 = 平野、大きいほど守りやすい）。水域は 0
      float m = clamp((g.b - 1.0) / 1.6, 0.0, 1.0);
      base = g.b < 0.5 ? vec3(0.16, 0.42, 0.72) : mix(vec3(0.78, 0.86, 0.62), vec3(0.45, 0.20, 0.12), m);
    } else if (uLayer == 4 || uLayer == 5) {
      // バイオーム色を、実際の植生密度で裸地色へ寄せる（潜在植生と実際の植生の両方を見せる §7.6）
      int id = int(e.a + 0.5);
      vec3 biomeColor = uBiomeColors[id];
      float cover = clamp(0.2 + 0.8 * e.b, 0.0, 1.0);
      bool special = id < 4; // 水域・雪・海岸・湿地は植生で薄めない
      vec3 land = special ? biomeColor : mix(uBare, biomeColor, cover);
      base = uLayer == 4 ? land : mix(vec3(0.85, 0.80, 0.62), vec3(0.10, 0.45, 0.20), clamp(e.b, 0.0, 1.0));
      base = mix(base, vec3(0.16, 0.42, 0.72), d.b); // 川
    } else {
      base = hypsometric(max(d.r, uSeaLevel));
      base = mix(base, vec3(0.16, 0.42, 0.72), d.b); // 川
    }
    // 農地と道路は、地形・バイオーム・植生の見た目の上に重ねる（ほかのレイヤーは色を読み取るのを邪魔しない）
    if (uLayer == 0 || uLayer == 4 || uLayer == 5) {
      if (f.r > 0.5 && f.r < 1.5) base = mix(base, uFarm, 0.55);
      if (f.b > 0.5) base = mix(base, uRoad, 0.85);
    }
    // 国: 領土の色（領土レイヤーでは濃く、ほかでは薄く）、国境の線、戦争の前線
    int own = int(g.r + 0.5);
    if (own > 0 && uLayer == 7) base = mix(base, uNation[own], 0.5);
    float ownL = texture2D(uData4, vTuv - vec2(px, 0.0)).r;
    float ownR = texture2D(uData4, vTuv + vec2(px, 0.0)).r;
    float ownU = texture2D(uData4, vTuv + vec2(0.0, px)).r;
    float ownD = texture2D(uData4, vTuv - vec2(0.0, px)).r;
    bool edge = own > 0 && (abs(ownL - g.r) > 0.5 || abs(ownR - g.r) > 0.5 || abs(ownU - g.r) > 0.5 || abs(ownD - g.r) > 0.5);
    if (edge) base = mix(base, uNation[own], uLayer == 7 ? 0.95 : 0.7);
    if (g.g > 0.5) base = mix(base, uFront, 0.8);
    // ダムの予測（新しくできる湖）
    float pv = texture2D(uPreview, vTuv).r;
    base = mix(base, uPreviewColor, pv * 0.7);
    gl_FragColor = vec4(base * shade, 1.0);
  }
`;

export const WATER_VERTEX = /* glsl */ `
  ${COMMON}
  varying float vDepth;
  void main() {
    vec2 tuv = texelUV(uv);
    vec4 d = texture2D(uData, tuv);
    bool hasWater = d.g > -0.5;
    float surface = hasWater ? d.g : d.r;       // 水が無い頂点は地表に置く（深さ0）
    vDepth = (surface - d.r) * uHeightScale;
    vec3 p = position;
    p.y = surface * uHeightScale;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

export const WATER_FRAGMENT = /* glsl */ `
  varying float vDepth;
  void main() {
    if (vDepth <= 0.02) discard;
    float t = clamp(vDepth / 12.0, 0.0, 1.0);
    vec3 shallow = vec3(0.25, 0.62, 0.72);
    vec3 deep = vec3(0.05, 0.20, 0.42);
    gl_FragColor = vec4(mix(shallow, deep, t), 0.88);
  }
`;
