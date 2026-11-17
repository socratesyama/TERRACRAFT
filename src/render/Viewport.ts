import {
  Color,
  Vector3,
  DataTexture,
  FloatType,
  Mesh,
  NearestFilter,
  PerspectiveCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PACK_CHANNELS } from '../core/renderPack';
import { TERRAIN_FRAGMENT, TERRAIN_VERTEX, WATER_FRAGMENT, WATER_VERTEX } from './shaders';

export interface ViewportOptions {
  /** グリッドの一辺（セル数）。scale.json から渡す */
  gridSize: number;
  seaLevel: number;
  /** 正規化標高 1.0 を何セル分の高さで描くか（runtime.json render.heightScale） */
  heightScale: number;
  /** 降水レイヤーの色の上限 mm/年（runtime.json render.precipLayerMaxMm） */
  precipMaxMm: number;
  temperatureMinC: number;
  temperatureMaxC: number;
  /** バイオーム番号順の表示色（#rrggbb）。runtime.json render.biomeColors と climate.biomeKeys から作る */
  biomeColors: string[];
  bareColor: string;
  devicePixelRatioMax: number;
  devicePixelRatioMaxMobile: number;
}

/** 0: 地形, 1: 降水, 2: 気温, 3: 水分, 4: バイオーム, 5: 植生 */
export type LayerIndex = 0 | 1 | 2 | 3 | 4 | 5;
const MAX_BIOMES = 16;

/**
 * 素の Three.js のホスト（react-three-fiber は使わない: 計画書 §3, §12）。
 * 地形は PlaneGeometry の頂点を、高さテクスチャ（RGBA32F、NearestFilter）で変位させる。
 * 頂点＝セルなので再メッシュ不要。水は同じ格子の別メッシュ（浅い→深いで色を変え、深さ0以下は discard）。
 * 生成したジオメトリ・マテリアル・テクスチャ・レンダラは dispose() で必ず解放する（§12.3）。
 */
export class TerrainViewport {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly geometry: PlaneGeometry;
  private readonly texture: DataTexture;
  private readonly texture2: DataTexture;
  private readonly terrainMaterial: ShaderMaterial;
  private readonly waterMaterial: ShaderMaterial;
  private readonly textureData: Float32Array;
  private readonly textureData2: Float32Array;
  private readonly observer: ResizeObserver;
  private raf = 0;
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    opts: ViewportOptions,
  ) {
    const { gridSize: size } = opts;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const dprMax = coarse ? opts.devicePixelRatioMaxMobile : opts.devicePixelRatioMax;

    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprMax));
    this.renderer.domElement.style.display = 'block';
    container.appendChild(this.renderer.domElement);

    this.scene.background = new Color(0x0a1420);
    this.camera = new PerspectiveCamera(45, 1, 1, size * 10);
    this.camera.position.set(0, size * 0.75, size * 0.85);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05; // 地面の下に潜らない
    this.controls.enableDamping = true;
    this.controls.target.set(0, opts.heightScale * 0.15, 0);

    // 高さテクスチャ（R 標高 / G 水面 / B 川 / A 降水）。最初は海抜0・水なし。
    this.textureData = new Float32Array(size * size * PACK_CHANNELS);
    for (let i = 0; i < size * size; i++) this.textureData[i * PACK_CHANNELS + 1] = -1;
    this.texture = new DataTexture(this.textureData, size, size, RGBAFormat, FloatType);
    this.texture.minFilter = NearestFilter;
    this.texture.magFilter = NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.textureData2 = new Float32Array(size * size * PACK_CHANNELS);
    this.texture2 = new DataTexture(this.textureData2, size, size, RGBAFormat, FloatType);
    this.texture2.minFilter = NearestFilter;
    this.texture2.magFilter = NearestFilter;
    this.texture2.generateMipmaps = false;
    this.texture2.needsUpdate = true;

    const colors: Vector3[] = [];
    for (let i = 0; i < MAX_BIOMES; i++) {
      const c = new Color(opts.biomeColors[i] ?? opts.bareColor);
      colors.push(new Vector3(c.r, c.g, c.b));
    }
    const bare = new Color(opts.bareColor);

    const uniforms = {
      uData: { value: this.texture },
      uData2: { value: this.texture2 },
      uTempRange: { value: [opts.temperatureMinC, opts.temperatureMaxC] },
      uBiomeColors: { value: colors },
      uBare: { value: new Vector3(bare.r, bare.g, bare.b) },
      uSize: { value: size },
      uHeightScale: { value: opts.heightScale },
      uSeaLevel: { value: opts.seaLevel },
      uPrecipMax: { value: opts.precipMaxMm },
      uLayer: { value: 0 },
    };

    // 頂点＝セル（計画書 §12.1）
    this.geometry = new PlaneGeometry(size - 1, size - 1, size - 1, size - 1);
    this.geometry.rotateX(-Math.PI / 2); // uv.y = 1 が北（-z）。グリッドの y は北向きに増える。

    this.terrainMaterial = new ShaderMaterial({
      uniforms,
      vertexShader: TERRAIN_VERTEX,
      fragmentShader: TERRAIN_FRAGMENT,
    });
    this.waterMaterial = new ShaderMaterial({
      uniforms,
      vertexShader: WATER_VERTEX,
      fragmentShader: WATER_FRAGMENT,
      transparent: true,
      depthWrite: false,
    });
    const terrain = new Mesh(this.geometry, this.terrainMaterial);
    const water = new Mesh(this.geometry, this.waterMaterial);
    water.renderOrder = 1;
    terrain.frustumCulled = false; // 頂点を GPU で動かすので、元の境界箱で切らない
    water.frustumCulled = false;
    this.scene.add(terrain, water);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    this.loop();
  }

  /** Worker からのスナップショット（renderPack.ts のレイアウト）を反映する。呼び出し側はコピー後にバッファを返却できる。 */
  setData(pack: Float32Array): void {
    const half = this.textureData.length;
    this.textureData.set(pack.subarray(0, half));
    this.textureData2.set(pack.subarray(half, half * 2));
    this.texture.needsUpdate = true;
    this.texture2.needsUpdate = true;
  }

  setLayer(layer: LayerIndex): void {
    this.terrainMaterial.uniforms.uLayer.value = layer;
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.controls.dispose();
    this.geometry.dispose();
    this.terrainMaterial.dispose();
    this.waterMaterial.dispose();
    this.texture.dispose();
    this.texture2.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
