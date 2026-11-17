import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DataTexture,
  FloatType,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  PerspectiveCamera,
  PlaneGeometry,
  RedFormat,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PACK_CHANNELS } from '../core/renderPack';
import type { Settlement } from '../core/world';
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
  /** runtime.json render.civColors */
  civColors: Record<string, string>;
  /** 集落マーカーの高さ（セル）。村・町・都市・港町 */
  settlementHeights: number[];
  devicePixelRatioMax: number;
  devicePixelRatioMaxMobile: number;
}

/** 0: 地形, 1: 降水, 2: 気温, 3: 水分, 4: バイオーム, 5: 植生, 6: 洪水リスク */
export type LayerIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;
const MAX_BIOMES = 16;
const MAX_MARKERS = 256;

function makeTexture(data: Float32Array, size: number): DataTexture {
  const t = new DataTexture(data, size, size, RGBAFormat, FloatType);
  t.minFilter = NearestFilter;
  t.magFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

const vec3 = (hex: string): Vector3 => {
  const c = new Color(hex);
  return new Vector3(c.r, c.g, c.b);
};

/**
 * 素の Three.js のホスト（react-three-fiber は使わない: 計画書 §3, §12）。
 * 地形は PlaneGeometry の頂点を、高さテクスチャ（RGBA32F、NearestFilter）で変位させる。
 * 頂点＝セルなので再メッシュ不要。水は同じ格子の別メッシュ。集落は InstancedMesh。
 * 生成したジオメトリ・マテリアル・テクスチャ・レンダラは dispose() で必ず解放する（§12.3）。
 */
export class TerrainViewport {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly geometry: PlaneGeometry;
  private readonly textures: DataTexture[] = [];
  private readonly arrays: Float32Array[] = [];
  private readonly preview: DataTexture;
  private readonly previewData: Uint8Array;
  private readonly terrainMaterial: ShaderMaterial;
  private readonly waterMaterial: ShaderMaterial;
  private readonly markers: InstancedMesh;
  private readonly markerGeometry: BoxGeometry;
  private readonly markerMaterial: MeshBasicMaterial;
  private readonly ring: Line;
  private readonly ringGeometry: BufferGeometry;
  private readonly ringMaterial: LineBasicMaterial;
  private readonly tierColors: Color[];
  private readonly observer: ResizeObserver;
  private readonly size: number;
  private readonly heightScale: number;
  private readonly settlementHeights: number[];
  private raf = 0;
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    opts: ViewportOptions,
  ) {
    const { gridSize: size } = opts;
    this.size = size;
    this.heightScale = opts.heightScale;
    this.settlementHeights = opts.settlementHeights;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const dprMax = coarse ? opts.devicePixelRatioMaxMobile : opts.devicePixelRatioMax;

    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprMax));
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.scene.background = new Color(0x0a1420);
    this.camera = new PerspectiveCamera(45, 1, 1, size * 10);
    this.camera.position.set(0, size * 0.75, size * 0.85);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05; // 地面の下に潜らない
    this.controls.enableDamping = true;
    this.controls.target.set(0, opts.heightScale * 0.15, 0);

    // データテクスチャ（renderPack.ts のレイアウト）: 1枚目 地形・水・川・降水、2枚目 気候・植生、3枚目 土地利用・人口・道路・洪水リスク
    for (let k = 0; k < 3; k++) {
      const arr = new Float32Array(size * size * PACK_CHANNELS);
      if (k === 0) for (let i = 0; i < size * size; i++) arr[i * PACK_CHANNELS + 1] = -1;
      this.arrays.push(arr);
      this.textures.push(makeTexture(arr, size));
    }
    this.previewData = new Uint8Array(size * size);
    this.preview = new DataTexture(this.previewData, size, size, RedFormat, UnsignedByteType);
    this.preview.minFilter = NearestFilter;
    this.preview.magFilter = NearestFilter;
    this.preview.generateMipmaps = false;
    this.preview.needsUpdate = true;

    const colors: Vector3[] = [];
    for (let i = 0; i < MAX_BIOMES; i++) colors.push(vec3(opts.biomeColors[i] ?? opts.bareColor));

    const uniforms = {
      uData: { value: this.textures[0] },
      uData2: { value: this.textures[1] },
      uData3: { value: this.textures[2] },
      uPreview: { value: this.preview },
      uSize: { value: size },
      uHeightScale: { value: opts.heightScale },
      uSeaLevel: { value: opts.seaLevel },
      uPrecipMax: { value: opts.precipMaxMm },
      uTempRange: { value: [opts.temperatureMinC, opts.temperatureMaxC] },
      uBiomeColors: { value: colors },
      uBare: { value: vec3(opts.bareColor) },
      uFarm: { value: vec3(opts.civColors.farm!) },
      uRoad: { value: vec3(opts.civColors.road!) },
      uFlood: { value: vec3(opts.civColors.floodRisk!) },
      uPreviewColor: { value: vec3(opts.civColors.preview!) },
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

    // 集落マーカー（村・町・都市・港町を色と高さで区別）
    this.tierColors = [opts.civColors.village!, opts.civColors.town!, opts.civColors.city!, opts.civColors.port!].map(
      (c) => new Color(c),
    );
    this.markerGeometry = new BoxGeometry(1, 1, 1);
    this.markerMaterial = new MeshBasicMaterial();
    this.markers = new InstancedMesh(this.markerGeometry, this.markerMaterial, MAX_MARKERS);
    this.markers.count = 0;
    this.markers.frustumCulled = false;
    this.markers.renderOrder = 2;
    this.scene.add(this.markers);

    // ブラシの輪
    this.ringGeometry = new BufferGeometry();
    this.ringMaterial = new LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 });
    this.ring = new Line(this.ringGeometry, this.ringMaterial);
    this.ring.visible = false;
    this.ring.renderOrder = 3;
    this.ring.frustumCulled = false;
    this.scene.add(this.ring);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    this.loop();
  }

  /** Worker からのスナップショット（renderPack.ts のレイアウト）を反映する。呼び出し側はコピー後にバッファを返却できる。 */
  setData(pack: Float32Array): void {
    const half = this.arrays[0]!.length;
    for (let k = 0; k < 3; k++) {
      this.arrays[k]!.set(pack.subarray(half * k, half * (k + 1)));
      this.textures[k]!.needsUpdate = true;
    }
  }

  setLayer(layer: LayerIndex): void {
    this.terrainMaterial.uniforms.uLayer!.value = layer;
  }

  /** 集落のマーカーを更新する（x, y はセル座標。y は北向き） */
  setSettlements(list: readonly Settlement[]): void {
    const m = new Matrix4();
    const count = Math.min(list.length, MAX_MARKERS);
    for (let i = 0; i < count; i++) {
      const s = list[i]!;
      const hCell = this.settlementHeights[s.tier] ?? 1;
      const gy = this.heightAt(s.x, s.y);
      m.makeScale(0.9 + s.tier * 0.25, hCell, 0.9 + s.tier * 0.25);
      m.setPosition(s.x - (this.size - 1) / 2, gy + hCell / 2, -(s.y - (this.size - 1) / 2));
      this.markers.setMatrixAt(i, m);
      this.markers.setColorAt(i, this.tierColors[s.tier]!);
    }
    this.markers.count = count;
    this.markers.instanceMatrix.needsUpdate = true;
    if (this.markers.instanceColor) this.markers.instanceColor.needsUpdate = true;
  }

  /** ダムの予測（新しくできる湖のマスク）を重ねる。null で消す */
  setPreview(mask: Uint8Array | null): void {
    if (mask) this.previewData.set(mask);
    else this.previewData.fill(0);
    this.preview.needsUpdate = true;
  }

  private heightAt(x: number, y: number): number {
    const cx = Math.min(this.size - 1, Math.max(0, Math.round(x)));
    const cy = Math.min(this.size - 1, Math.max(0, Math.round(y)));
    return this.arrays[0]![(cy * this.size + cx) * PACK_CHANNELS]! * this.heightScale;
  }

  /** 画面上の点を、地形の上の格子座標（セル、y は北向き）へ。光線を進めて地形に当たる点を探す。 */
  pick(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    const origin = this.camera.position.clone();
    const dir = new Vector3(nx, ny, 0.5).unproject(this.camera).sub(origin).normalize();
    const half = (this.size - 1) / 2;
    const toCell = (p: Vector3): { x: number; y: number } => ({ x: p.x + half, y: -p.z + half });
    const above = (p: Vector3): boolean => {
      const c = toCell(p);
      return p.y > this.heightAt(c.x, c.y);
    };
    const step = 0.5;
    const maxT = this.size * 4;
    let prev = origin.clone();
    for (let t = step; t < maxT; t += step) {
      const p = origin.clone().addScaledVector(dir, t);
      const c = toCell(p);
      if (c.x >= -0.5 && c.x <= this.size - 0.5 && c.y >= -0.5 && c.y <= this.size - 0.5 && !above(p)) {
        // 二分法で交点を詰める
        let lo = prev;
        let hi = p;
        for (let k = 0; k < 8; k++) {
          const mid = lo.clone().add(hi).multiplyScalar(0.5);
          if (above(mid)) lo = mid;
          else hi = mid;
        }
        const r = toCell(hi);
        return { x: Math.min(this.size - 1, Math.max(0, r.x)), y: Math.min(this.size - 1, Math.max(0, r.y)) };
      }
      prev = p;
    }
    return null;
  }

  /** ブラシの輪を (x, y)（セル）に半径 rCells で出す。null で隠す */
  setBrush(at: { x: number; y: number } | null, rCells: number): void {
    if (!at) {
      this.ring.visible = false;
      return;
    }
    const pts: Vector3[] = [];
    const half = (this.size - 1) / 2;
    for (let k = 0; k <= 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      const cx = at.x + Math.cos(a) * rCells;
      const cy = at.y + Math.sin(a) * rCells;
      pts.push(new Vector3(cx - half, this.heightAt(cx, cy) + 0.6, -(cy - half)));
    }
    this.ringGeometry.setFromPoints(pts);
    this.ring.visible = true;
  }

  /** イベントログのクリックで、その場所へカメラを寄せる */
  focusOn(x: number, y: number): void {
    const half = (this.size - 1) / 2;
    const target = new Vector3(x - half, this.heightAt(x, y), -(y - half));
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.setLength(Math.min(offset.length(), this.size * 0.45));
    this.controls.target.copy(target);
    this.camera.position.copy(target).add(offset);
  }

  setOrbitEnabled(on: boolean): void {
    this.controls.enabled = on;
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

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.controls.dispose();
    this.geometry.dispose();
    this.terrainMaterial.dispose();
    this.waterMaterial.dispose();
    this.markerGeometry.dispose();
    this.markerMaterial.dispose();
    this.markers.dispose();
    this.ringGeometry.dispose();
    this.ringMaterial.dispose();
    for (const t of this.textures) t.dispose();
    this.preview.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
