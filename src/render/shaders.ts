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
  uniform float uSeaLevel;
  uniform float uPrecipMax;
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

  void main() {
    vec4 d = texture2D(uData, vTuv);
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
    } else {
      base = hypsometric(max(d.r, uSeaLevel));
      base = mix(base, vec3(0.16, 0.42, 0.72), d.b); // 川
    }
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
