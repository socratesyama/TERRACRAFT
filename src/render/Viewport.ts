import {
  Color,
  HemisphereLight,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface ViewportOptions {
  /** グリッドの一辺（セル数）。scale.json から渡す */
  gridSize: number;
  devicePixelRatioMax: number;
  devicePixelRatioMaxMobile: number;
}

/**
 * 素の Three.js のホスト（react-three-fiber は使わない: 計画書 §3）。
 * M0 は空のシーン（平面・光・軌道カメラ）。M1 で高さテクスチャの頂点変位に置き換える。
 * 生成したジオメトリ・マテリアル・レンダラは dispose() で必ず解放する（§12.3）。
 */
export class TerrainViewport {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly ground: Mesh;
  private readonly observer: ResizeObserver;
  private raf = 0;
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    opts: ViewportOptions,
  ) {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const dprMax = coarse ? opts.devicePixelRatioMaxMobile : opts.devicePixelRatioMax;

    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprMax));
    this.renderer.domElement.style.display = 'block';
    container.appendChild(this.renderer.domElement);

    this.scene.background = new Color(0x0b1520);
    this.camera = new PerspectiveCamera(45, 1, 1, opts.gridSize * 10);
    this.camera.position.set(0, opts.gridSize * 0.8, opts.gridSize * 0.9);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05; // 地面の下に潜らない
    this.controls.enableDamping = true;

    this.scene.add(new HemisphereLight(0xdfeeff, 0x2a3a2a, 1.0));
    const sun = new DirectionalLight(0xffffff, 1.5);
    sun.position.set(opts.gridSize, opts.gridSize, opts.gridSize * 0.5);
    this.scene.add(sun);

    // 頂点＝セル（計画書 §12.1）。M1 で頂点シェーダの変位に差し替える。
    const g = new PlaneGeometry(opts.gridSize - 1, opts.gridSize - 1, opts.gridSize - 1, opts.gridSize - 1);
    g.rotateX(-Math.PI / 2);
    this.ground = new Mesh(g, new MeshStandardMaterial({ color: 0x3d5a45, roughness: 1 }));
    this.scene.add(this.ground);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    this.loop();
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
    this.ground.geometry.dispose();
    (this.ground.material as MeshStandardMaterial).dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
