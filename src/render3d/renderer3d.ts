/**
 * Renderer 3D (tuỳ chọn, bật/tắt khi đang chạy) bằng Three.js.
 *
 *  - Địa hình: lưới 200×200 đỉnh dựng từ heightmap, phủ đúng ảnh nền của renderer 2D làm texture
 *    (nên mùa, tuyết, cỏ bị gặm, vết cháy… hiện ra giống hệt 2D).
 *  - Nước: một mặt phẳng trong suốt ở cao độ của mực nước hiện tại (dâng/hạ theo thời tiết).
 *  - Cây rừng và sinh vật: InstancedMesh — mỗi loài vài lệnh vẽ dù có hàng nghìn cá thể.
 *  - Ngoại hình theo gen: kích thước (tỉ lệ), màu lông (màu instance), tốc độ (chân dài hơn),
 *    chịu lạnh (thân to xù hơn), sải cánh (cánh dài hơn).
 *
 * Chỉ đọc `RenderSnapshot`; không có logic mô phỏng nào ở đây.
 */
import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  InstancedMesh,
  LinearFilter,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  SRGBColorSpace,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL_SIZE, GRID, MOUNTAIN_LEVEL, WORLD_SIZE } from '../sim/constants';
import { State } from '../sim/entities';
import {
  CORPSE_STRIDE,
  type RenderSnapshot,
  SNAPSHOT_STRIDE,
  SNAP_GENE_COLD,
  SNAP_GENE_HUE,
  SNAP_GENE_LIGHT,
  SNAP_GENE_SPECIAL,
  SNAP_GENE_SPEED,
  SNAP_HEADING_X,
  SNAP_HEADING_Y,
  SNAP_ID,
  SNAP_MASS,
  SNAP_SPECIES,
  SNAP_STATE,
  SNAP_VX,
  SNAP_VY,
  SNAP_X,
  SNAP_Y,
} from '../sim/snapshot';
import { BODY_LENGTH, type WorldRenderer, hash01, hslToRgb } from '../render/common';
import { GroundLayer } from '../render2d/ground';
import type { AnimalMeta, WorldMeta } from '../worker/protocol';

/** Độ cao hiển thị (u) của một độ cao chuẩn hoá: đồng bằng thoai thoải, núi dựng lên nhanh. */
function heightOf(elevation: number): number {
  const peak = elevation > 0.78 ? elevation - 0.78 : 0;
  return 60 * elevation + 1300 * peak * peak;
}

/** Chim đang bay ở cao hơn mặt đất chừng này (u). */
const FLIGHT_ALTITUDE = 22;

/** Gán màu đỉnh đồng nhất cho một hình (sẽ được nhân với màu instance). */
function tint(geometry: BufferGeometry, shade: number): BufferGeometry {
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3).fill(shade);
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

function ellipsoid(
  rx: number,
  ry: number,
  rz: number,
  x: number,
  y: number,
  z: number,
  shade = 1,
): BufferGeometry {
  const geometry = new SphereGeometry(1, 10, 7);
  geometry.scale(rx, ry, rz);
  geometry.translate(x, y, z);
  return tint(geometry, shade);
}

function box(sx: number, sy: number, sz: number, x: number, y: number, z: number, shade = 1): BufferGeometry {
  const geometry = new BoxGeometry(sx, sy, sz);
  geometry.translate(x, y, z);
  return tint(geometry, shade);
}

function cone(
  radius: number,
  height: number,
  x: number,
  y: number,
  z: number,
  shade = 1,
  rotateZ = 0,
): BufferGeometry {
  const geometry = new ConeGeometry(radius, height, 6);
  if (rotateZ !== 0) geometry.rotateZ(rotateZ);
  geometry.translate(x, y, z);
  return tint(geometry, shade);
}

/** Hình dạng 3D của một loài: phần thân (gồm đầu, tai, đuôi) và phần "chi" co giãn theo gen (chân hoặc cánh). */
interface Model {
  body: BufferGeometry;
  /** Chân (thú) — co giãn theo trục Y bằng gen tốc độ; hoặc cánh trái/phải (chim) — co giãn theo gen sải cánh. */
  limbs: BufferGeometry | null;
  limbsRight: BufferGeometry | null;
  /** Chiều cao hông (theo đơn vị chiều dài thân) — thân được nâng lên ngần này. */
  hip: number;
  kind: 'quadruped' | 'bird' | 'fish' | 'frog';
}

/** Dựng mô hình low‑poly cho một kiểu hình dạng. Đơn vị: chiều dài thân = 1, đầu hướng +X, trục Y hướng lên. */
function buildModel(shape: string): Model {
  const quadruped = (
    width: number,
    height: number,
    hip: number,
    head: number,
    neck: number,
    parts: BufferGeometry[],
  ): Model => {
    const body = mergeGeometries([
      ellipsoid(0.5, height / 2, width / 2, 0, 0, 0),
      ellipsoid(head * 0.6, head * 0.5, head * 0.5, 0.5 + neck + head * 0.3, neck * 0.9 + height * 0.15, 0),
      ...parts,
    ]);
    const leg = (x: number, z: number): BufferGeometry => box(0.09, 1, 0.09, x, -0.5, z, 0.72);
    const limbs = mergeGeometries([
      leg(0.3, width * 0.32),
      leg(0.3, -width * 0.32),
      leg(-0.3, width * 0.32),
      leg(-0.3, -width * 0.32),
    ]);
    return { body, limbs, limbsRight: null, hip, kind: 'quadruped' };
  };
  switch (shape) {
    case 'rabbit':
      return quadruped(0.5, 0.5, 0.2, 0.34, 0, [
        ellipsoid(0.2, 0.05, 0.05, 0.52, 0.42, 0.09, 0.8),
        ellipsoid(0.2, 0.05, 0.05, 0.52, 0.42, -0.09, 0.8),
        ellipsoid(0.1, 0.1, 0.1, -0.52, 0.08, 0, 1.6),
      ]);
    case 'deer':
      return quadruped(0.32, 0.38, 0.5, 0.24, 0.16, [
        ellipsoid(0.16, 0.2, 0.1, 0.5, 0.2, 0),
        cone(0.03, 0.26, 0.62, 0.62, 0.08, 1.5),
        cone(0.03, 0.26, 0.62, 0.62, -0.08, 1.5),
        ellipsoid(0.06, 0.06, 0.05, -0.52, 0.08, 0, 1.6),
      ]);
    case 'fox':
      return quadruped(0.3, 0.3, 0.3, 0.26, 0.05, [
        cone(0.05, 0.12, 0.6, 0.3, 0.07, 0.75),
        cone(0.05, 0.12, 0.6, 0.3, -0.07, 0.75),
        ellipsoid(0.34, 0.11, 0.11, -0.78, 0.02, 0),
        ellipsoid(0.1, 0.09, 0.09, -1.08, 0.02, 0, 1.7),
      ]);
    case 'wolf':
      return quadruped(0.34, 0.36, 0.38, 0.28, 0.08, [
        cone(0.05, 0.12, 0.66, 0.36, 0.08, 0.7),
        cone(0.05, 0.12, 0.66, 0.36, -0.08, 0.7),
        ellipsoid(0.26, 0.07, 0.07, -0.7, 0, 0, 0.8),
      ]);
    case 'bear':
      return quadruped(0.6, 0.56, 0.3, 0.32, 0, [
        ellipsoid(0.06, 0.06, 0.06, 0.6, 0.36, 0.14, 0.75),
        ellipsoid(0.06, 0.06, 0.06, 0.6, 0.36, -0.14, 0.75),
      ]);
    case 'boar':
      return quadruped(0.46, 0.46, 0.26, 0.3, 0, [
        cone(0.08, 0.2, 0.86, 0.05, 0, 0.8, -Math.PI / 2),
        ellipsoid(0.42, 0.06, 0.1, -0.05, 0.24, 0, 0.6),
      ]);
    case 'eagle':
    case 'vulture': {
      const vulture = shape === 'vulture';
      const body = mergeGeometries([
        ellipsoid(0.42, 0.14, 0.16, 0, 0, 0),
        ellipsoid(0.12, 0.1, 0.1, 0.46, 0.04, 0, vulture ? 1.9 : 1.8),
        cone(0.04, 0.16, 0.62, 0.02, 0, vulture ? 0.5 : 2.2, -Math.PI / 2),
        box(0.3, 0.02, 0.34, -0.55, 0, 0, 0.7),
      ]);
      // Cánh: một tấm mỏng gốc ở thân, vươn theo ±Z (gen sải cánh co giãn trục Z).
      const wing = (side: number): BufferGeometry => {
        const geometry = new BoxGeometry(0.42, 0.025, 1);
        geometry.translate(-0.02, 0.03, side * 0.5);
        return tint(geometry, 0.85);
      };
      return { body, limbs: wing(1), limbsRight: wing(-1), hip: 0.16, kind: 'bird' };
    }
    case 'fish': {
      const tail = new BoxGeometry(0.28, 0.34, 0.03);
      tail.translate(-0.6, 0, 0);
      const body = mergeGeometries([
        ellipsoid(0.5, 0.22, 0.13, 0, 0, 0),
        tint(tail, 0.7),
        box(0.2, 0.14, 0.02, 0, 0.26, 0, 0.7),
      ]);
      return { body, limbs: null, limbsRight: null, hip: 0, kind: 'fish' };
    }
    default: {
      const body = mergeGeometries([
        ellipsoid(0.46, 0.24, 0.34, 0, 0.24, 0),
        ellipsoid(0.09, 0.09, 0.09, 0.28, 0.46, 0.16, 1.5),
        ellipsoid(0.09, 0.09, 0.09, 0.28, 0.46, -0.16, 1.5),
        box(0.5, 0.08, 0.1, -0.35, 0.08, 0.34, 0.75),
        box(0.5, 0.08, 0.1, -0.35, 0.08, -0.34, 0.75),
      ]);
      return { body, limbs: null, limbsRight: null, hip: 0, kind: 'frog' };
    }
  }
}

interface SpeciesMeshes {
  meta: AnimalMeta;
  model: Model;
  body: InstancedMesh;
  limbs: InstancedMesh | null;
  limbsRight: InstancedMesh | null;
  /** Mã định danh của cá thể ứng với từng instance (để bắt chuột). */
  ids: Float64Array;
  capacity: number;
  count: number;
}

export class Renderer3D implements WorldRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(50, 1, 2, 9000);
  private readonly controls: OrbitControls;
  private readonly sun = new DirectionalLight(0xffffff, 1.5);
  private readonly ambient = new AmbientLight(0xffffff, 0.6);
  private readonly ground = new GroundLayer();
  private readonly groundTexture: CanvasTexture;
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  private readonly raycaster = new Raycaster();
  private terrain: Mesh | null = null;
  private water: Mesh | null = null;
  private trees: InstancedMesh | null = null;
  private corpses: InstancedMesh | null = null;
  private species: SpeciesMeshes[] = [];
  private meta: WorldMeta | null = null;
  private heights = new Float32Array(GRID * GRID);
  private follow = false;
  private groundTick = -1;
  private groundLevel = -1;
  private treeSeason = -1;
  private width = 1;
  private height = 1;
  private readonly selectedPosition = new Vector3();
  private readonly cleanup: (() => void)[] = [];
  private readonly dayColor = new Color(0x9fc9e8);
  private readonly nightColor = new Color(0x0a1228);
  private readonly skyColor = new Color();
  private readonly scratchColor = new Color();

  constructor(private readonly onClick: (screenX: number, screenY: number) => void) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'view-canvas';
    this.groundTexture = new CanvasTexture(this.ground.canvas);
    this.groundTexture.colorSpace = SRGBColorSpace;
    this.groundTexture.magFilter = LinearFilter;
    this.groundTexture.minFilter = LinearFilter;
    this.groundTexture.generateMipmaps = false;

    this.camera.position.set(WORLD_SIZE / 2, 900, WORLD_SIZE * 1.15);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.set(WORLD_SIZE / 2, 20, WORLD_SIZE / 2);
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 25;
    this.controls.maxDistance = 3600;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.update();

    this.sun.position.set(-600, 1200, 500);
    this.scene.add(this.sun, this.ambient);
    this.scene.fog = new Fog(0x9fc9e8, 1800, 6500);

    // Phân biệt bấm với kéo: chỉ coi là bấm nếu con trỏ gần như không di chuyển.
    let downX = 0;
    let downY = 0;
    const down = (event: PointerEvent): void => {
      downX = event.clientX;
      downY = event.clientY;
    };
    const up = (event: PointerEvent): void => {
      if (Math.abs(event.clientX - downX) + Math.abs(event.clientY - downY) > 5) return;
      const rect = this.canvas.getBoundingClientRect();
      this.onClick(event.clientX - rect.left, event.clientY - rect.top);
    };
    this.canvas.addEventListener('pointerdown', down);
    this.canvas.addEventListener('pointerup', up);
    this.cleanup.push(() => {
      this.canvas.removeEventListener('pointerdown', down);
      this.canvas.removeEventListener('pointerup', up);
    });
  }

  // ───────────────────────────── Dựng cảnh ─────────────────────────────

  setWorld(meta: WorldMeta): void {
    this.meta = meta;
    this.ground.setWorld(meta);
    this.groundTick = -1;
    this.treeSeason = -1;
    for (const object of [this.terrain, this.water, this.trees, this.corpses]) {
      if (object) {
        this.scene.remove(object);
        object.geometry.dispose();
      }
    }
    for (const entry of this.species) {
      this.scene.remove(entry.body);
      if (entry.limbs) this.scene.remove(entry.limbs);
      if (entry.limbsRight) this.scene.remove(entry.limbsRight);
    }

    // Địa hình: mỗi đỉnh là tâm một ô lưới.
    const geometry = new PlaneGeometry(WORLD_SIZE - CELL_SIZE, WORLD_SIZE - CELL_SIZE, GRID - 1, GRID - 1);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(WORLD_SIZE / 2, 0, WORLD_SIZE / 2);
    const positions = geometry.attributes.position;
    for (let k = 0; k < positions.count; k++) {
      const cx = Math.round((positions.getX(k) - CELL_SIZE / 2) / CELL_SIZE);
      const cy = Math.round((positions.getZ(k) - CELL_SIZE / 2) / CELL_SIZE);
      const cell = Math.min(GRID - 1, Math.max(0, cy)) * GRID + Math.min(GRID - 1, Math.max(0, cx));
      const y = heightOf(meta.elevation[cell]);
      this.heights[cell] = y;
      positions.setY(k, y);
    }
    geometry.computeVertexNormals();
    this.terrain = new Mesh(geometry, new MeshLambertMaterial({ map: this.groundTexture }));
    this.scene.add(this.terrain);

    const waterGeometry = new PlaneGeometry(WORLD_SIZE, WORLD_SIZE);
    waterGeometry.rotateX(-Math.PI / 2);
    waterGeometry.translate(WORLD_SIZE / 2, 0, WORLD_SIZE / 2);
    this.water = new Mesh(
      waterGeometry,
      new MeshLambertMaterial({ color: 0x2f7fb8, transparent: true, opacity: 0.62 }),
    );
    this.scene.add(this.water);

    // Cây rừng: cùng vị trí (theo hàm băm) với cây trong renderer 2D.
    const treeGeometry = mergeGeometries([
      tint(new CylinderGeometry(0.12, 0.16, 0.6, 5).translate(0, 0.3, 0), 0.45),
      tint(new ConeGeometry(0.55, 1.5, 6).translate(0, 1.3, 0), 1),
    ]);
    const spots: number[] = [];
    for (let cell = 0; cell < GRID * GRID; cell++) {
      const cover = meta.canopy[cell];
      if (cover < 0.3 || meta.elevation[cell] > MOUNTAIN_LEVEL) continue;
      const trees = cover > 0.75 ? 2 : 1;
      for (let k = 0; k < trees; k++) spots.push(cell * 3 + k);
    }
    this.trees = new InstancedMesh(treeGeometry, this.material, spots.length);
    const matrix = this.trees.instanceMatrix.array as Float32Array;
    spots.forEach((seed, index) => {
      const cell = Math.floor(seed / 3);
      const x = ((cell % GRID) + hash01(seed)) * CELL_SIZE;
      const z = (Math.floor(cell / GRID) + hash01(seed + 17)) * CELL_SIZE;
      const size = (5 + 5 * hash01(seed + 29)) * (0.7 + 0.5 * meta.canopy[cell]);
      const o = index * 16;
      matrix.fill(0, o, o + 16);
      matrix[o] = size;
      matrix[o + 5] = size * (1.1 + 0.5 * hash01(seed + 41));
      matrix[o + 10] = size;
      matrix[o + 12] = x;
      matrix[o + 13] = this.heightAt(x, z) - 0.5;
      matrix[o + 14] = z;
      matrix[o + 15] = 1;
    });
    this.trees.instanceMatrix.needsUpdate = true;
    this.trees.frustumCulled = false;
    this.trees.userData.seeds = spots;
    this.scene.add(this.trees);

    this.corpses = new InstancedMesh(
      tint(new BoxGeometry(1, 0.35, 0.6), 1),
      new MeshLambertMaterial({ color: 0x8a2424, vertexColors: true }),
      4096,
    );
    this.corpses.frustumCulled = false;
    this.corpses.count = 0;
    this.scene.add(this.corpses);

    this.species = meta.animals.map((animal) => {
      const model = buildModel(animal.shape);
      const capacity = 2048;
      const make = (geometry: BufferGeometry | null): InstancedMesh | null => {
        if (!geometry) return null;
        const mesh = new InstancedMesh(geometry, this.material, capacity);
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.setColorAt(0, this.scratchColor.setRGB(1, 1, 1));
        this.scene.add(mesh);
        return mesh;
      };
      return {
        meta: animal,
        model,
        body: make(model.body)!,
        limbs: make(model.limbs),
        limbsRight: make(model.limbsRight),
        ids: new Float64Array(capacity),
        capacity,
        count: 0,
      };
    });
  }

  /** Mở rộng sức chứa instance của một loài khi quần thể vượt quá. */
  private grow(entry: SpeciesMeshes, needed: number): void {
    const capacity = Math.max(needed, entry.capacity * 2);
    const replace = (mesh: InstancedMesh | null): InstancedMesh | null => {
      if (!mesh) return null;
      const next = new InstancedMesh(mesh.geometry, this.material, capacity);
      next.frustumCulled = false;
      next.setColorAt(0, this.scratchColor.setRGB(1, 1, 1));
      this.scene.remove(mesh);
      mesh.dispose();
      this.scene.add(next);
      return next;
    };
    entry.body = replace(entry.body)!;
    entry.limbs = replace(entry.limbs);
    entry.limbsRight = replace(entry.limbsRight);
    entry.ids = new Float64Array(capacity);
    entry.capacity = capacity;
  }

  /** Độ cao mặt đất tại một điểm (nội suy song tuyến tính giữa các tâm ô). */
  private heightAt(x: number, z: number): number {
    const gx = Math.min(GRID - 1.001, Math.max(0, x / CELL_SIZE - 0.5));
    const gz = Math.min(GRID - 1.001, Math.max(0, z / CELL_SIZE - 0.5));
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const h = this.heights;
    const a = h[iz * GRID + ix];
    const b = h[iz * GRID + ix + 1];
    const c = h[(iz + 1) * GRID + ix];
    const d = h[(iz + 1) * GRID + ix + 1];
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(this.width, this.height, true);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  setFollow(follow: boolean): void {
    this.follow = follow;
  }

  lookAt(x: number, y: number): void {
    const target = new Vector3(x, this.heightAt(x, y), y);
    const offset = this.camera.position.clone().sub(this.controls.target);
    if (offset.length() > 220) offset.setLength(160);
    this.controls.target.copy(target);
    this.camera.position.copy(target).add(offset);
  }

  // ───────────────────────────── Vẽ ─────────────────────────────

  render(snapshot: RenderSnapshot, alpha: number, time: number, selectedId: number): void {
    const meta = this.meta;
    if (!meta || !this.terrain || !this.water) return;
    const climate = snapshot.climate;
    if (
      snapshot.fields ||
      this.groundTick < 0 ||
      Math.abs(climate.waterLevel - this.groundLevel) > 0.0008 ||
      snapshot.tick - this.groundTick > 240
    ) {
      this.ground.update(snapshot);
      this.groundTexture.needsUpdate = true;
      this.groundTick = snapshot.tick;
      this.groundLevel = climate.waterLevel;
    }
    const waterY = heightOf(climate.waterLevel);
    this.water.position.y = waterY;

    // Ánh sáng theo giờ trong ngày.
    const light = climate.daylight;
    this.sun.intensity = 0.25 + 1.5 * light;
    this.ambient.intensity = 0.3 + 0.45 * light;
    this.skyColor.copy(this.nightColor).lerp(this.dayColor, light);
    this.scene.background = this.skyColor;
    (this.scene.fog as Fog).color.copy(this.skyColor);

    // Màu tán cây theo mùa (chỉ cập nhật khi mùa đổi).
    const season = climate.snow ? 4 : climate.season;
    if (this.trees && season !== this.treeSeason) {
      this.treeSeason = season;
      const palette: [number, number, number][] =
        season === 4
          ? [[0.62, 0.72, 0.66]]
          : season === 2
            ? [
                [0.72, 0.42, 0.12],
                [0.8, 0.55, 0.16],
                [0.55, 0.36, 0.1],
              ]
            : [
                [0.18, 0.44, 0.22],
                [0.24, 0.52, 0.27],
                [0.15, 0.36, 0.19],
              ];
      const seeds = this.trees.userData.seeds as number[];
      seeds.forEach((seed, index) => {
        const [r, g, b] = palette[Math.floor(hash01(seed + 91) * palette.length)];
        this.trees!.setColorAt(index, this.scratchColor.setRGB(r, g, b));
      });
      if (this.trees.instanceColor) this.trees.instanceColor.needsUpdate = true;
    }

    // Sinh vật.
    const animals = snapshot.animals;
    for (const entry of this.species) entry.count = 0;
    const counts = new Int32Array(this.species.length);
    for (let k = 0; k < snapshot.count; k++) counts[animals[k * SNAPSHOT_STRIDE + SNAP_SPECIES]]++;
    this.species.forEach((entry, index) => {
      if (counts[index] > entry.capacity) this.grow(entry, counts[index]);
    });
    let hasSelected = false;
    for (let k = 0; k < snapshot.count; k++) {
      const o = k * SNAPSHOT_STRIDE;
      const entry = this.species[animals[o + SNAP_SPECIES]];
      const model = entry.model;
      const state = animals[o + SNAP_STATE];
      const x = animals[o + SNAP_X] + animals[o + SNAP_VX] * alpha;
      const z = animals[o + SNAP_Y] + animals[o + SNAP_VY] * alpha;
      const id = animals[o + SNAP_ID];
      const speed = Math.sqrt(
        animals[o + SNAP_VX] * animals[o + SNAP_VX] + animals[o + SNAP_VY] * animals[o + SNAP_VY],
      );
      const cold = animals[o + SNAP_GENE_COLD];
      const length = (BODY_LENGTH[entry.meta.shape] ?? 5) * Math.cbrt(animals[o + SNAP_MASS]);
      const girth = length * (1 + 0.25 * cold);
      const ground = this.heightAt(x, z);
      const phase = time * (4 + speed * 9) + id * 1.7;
      let y: number;
      let legScale = 0;
      let wingScale = 0;
      let wingTilt = 0;
      switch (model.kind) {
        case 'quadruped':
          // Gen tốc độ làm chân dài hơn → thân được nâng cao hơn.
          legScale =
            length *
            model.hip *
            (0.55 + 0.75 * (animals[o + SNAP_GENE_SPEED] - 0.6)) *
            (state === State.REST || state === State.HIBERNATE ? 0.35 : 1);
          y =
            Math.max(ground, waterY - girth * 0.2) +
            legScale +
            girth * 0.22 +
            Math.abs(Math.sin(phase)) * speed * 0.25;
          break;
        case 'bird': {
          const airborne = state !== State.REST && state !== State.EAT && state !== State.HIBERNATE;
          y = Math.max(ground, waterY) + (airborne ? FLIGHT_ALTITUDE : length * 0.2);
          wingScale = length * (1.0 + 0.9 * animals[o + SNAP_GENE_SPECIAL]) * (airborne ? 1 : 0.25);
          wingTilt = airborne ? Math.sin(time * 7 + id) * 0.45 : 1.2;
          break;
        }
        case 'fish':
          y = waterY - length * 0.35;
          break;
        default:
          y = Math.max(ground, waterY - length * 0.1) + Math.abs(Math.sin(phase * 0.5)) * speed * 1.2;
      }
      // Hướng nhìn; cá lắc thân nhẹ khi bơi.
      let hx = animals[o + SNAP_HEADING_X];
      let hz = animals[o + SNAP_HEADING_Y];
      if (model.kind === 'fish') {
        const wiggle = Math.sin(phase * 1.3) * 0.25;
        const cos = Math.cos(wiggle);
        const sin = Math.sin(wiggle);
        const nx = hx * cos - hz * sin;
        hz = hx * sin + hz * cos;
        hx = nx;
      }
      const n = entry.count++;
      entry.ids[n] = id;
      writeMatrix(
        entry.body.instanceMatrix.array as Float32Array,
        n,
        x,
        y,
        z,
        hx,
        hz,
        length,
        girth,
        girth,
        0,
      );
      const [r, g, b] = hslToRgb(
        animals[o + SNAP_GENE_HUE],
        entry.meta.saturation,
        animals[o + SNAP_GENE_LIGHT],
      );
      const tintScale = state === State.HIBERNATE ? 0.6 : 1;
      this.scratchColor.setRGB(r * tintScale, g * tintScale, b * tintScale, SRGBColorSpace);
      entry.body.setColorAt(n, this.scratchColor);
      if (entry.limbs && model.kind === 'quadruped') {
        writeMatrix(
          entry.limbs.instanceMatrix.array as Float32Array,
          n,
          x,
          y - girth * 0.1,
          z,
          hx,
          hz,
          length,
          legScale + girth * 0.15,
          girth,
          0,
        );
        entry.limbs.setColorAt(n, this.scratchColor);
      } else if (entry.limbs && entry.limbsRight) {
        writeMatrix(
          entry.limbs.instanceMatrix.array as Float32Array,
          n,
          x,
          y,
          z,
          hx,
          hz,
          length,
          length,
          wingScale,
          wingTilt,
        );
        writeMatrix(
          entry.limbsRight.instanceMatrix.array as Float32Array,
          n,
          x,
          y,
          z,
          hx,
          hz,
          length,
          length,
          wingScale,
          -wingTilt,
        );
        entry.limbs.setColorAt(n, this.scratchColor);
        entry.limbsRight.setColorAt(n, this.scratchColor);
      }
      if (id === selectedId) {
        hasSelected = true;
        this.selectedPosition.set(x, y, z);
      }
    }
    for (const entry of this.species) {
      for (const mesh of [entry.body, entry.limbs, entry.limbsRight]) {
        if (!mesh) continue;
        mesh.count = entry.count;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }

    // Xác.
    if (this.corpses) {
      const total = Math.min(snapshot.corpseCount, 4096);
      const array = this.corpses.instanceMatrix.array as Float32Array;
      for (let k = 0; k < total; k++) {
        const x = snapshot.corpses[k * CORPSE_STRIDE];
        const z = snapshot.corpses[k * CORPSE_STRIDE + 1];
        const size = Math.max(1.2, Math.min(9, Math.cbrt(snapshot.corpses[k * CORPSE_STRIDE + 2]) * 0.9));
        writeMatrix(array, k, x, Math.max(this.heightAt(x, z), waterY) + 0.3, z, 1, 0, size, size, size, 0);
      }
      this.corpses.count = total;
      this.corpses.instanceMatrix.needsUpdate = true;
    }

    if (this.follow && hasSelected) {
      // Dời cả đích lẫn camera theo con vật: người dùng vẫn xoay/zoom quanh nó được.
      const delta = this.selectedPosition.clone().sub(this.controls.target).multiplyScalar(0.2);
      this.controls.target.add(delta);
      this.camera.position.add(delta);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  pick(_snapshot: RenderSnapshot, screenX: number, screenY: number): number {
    const pointer = new Vector2((screenX / this.width) * 2 - 1, -(screenY / this.height) * 2 + 1);
    this.raycaster.setFromCamera(pointer, this.camera);
    let best = 0;
    let bestDistance = Infinity;
    for (const entry of this.species) {
      if (entry.count === 0) continue;
      // Three.js cần hình cầu bao của toàn bộ instance; tính lại vì vị trí đổi liên tục.
      entry.body.computeBoundingSphere();
      for (const hit of this.raycaster.intersectObject(entry.body, false)) {
        if (hit.instanceId !== undefined && hit.distance < bestDistance) {
          bestDistance = hit.distance;
          best = entry.ids[hit.instanceId];
        }
      }
    }
    return best;
  }

  screenToWorld(screenX: number, screenY: number): { x: number; y: number } | null {
    if (!this.terrain) return null;
    const pointer = new Vector2((screenX / this.width) * 2 - 1, -(screenY / this.height) * 2 + 1);
    this.raycaster.setFromCamera(pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.terrain, false)[0];
    return hit ? { x: hit.point.x, y: hit.point.z } : null;
  }

  /** Số lệnh vẽ và số tam giác của khung hình gần nhất (để báo cáo hiệu năng). */
  get renderInfo(): { calls: number; triangles: number } {
    return { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles };
  }

  dispose(): void {
    for (const off of this.cleanup) off();
    this.controls.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

/**
 * Ghi ma trận instance: tịnh tiến (x, y, z), xoay quanh trục Y sao cho +X của mô hình trỏ theo (hx, hz),
 * co giãn (sx, sy, sz), và nghiêng quanh trục X của mô hình một góc `roll` (để vỗ cánh).
 * Viết thẳng vào mảng thay vì dùng Object3D để tránh hàng chục nghìn lần cấp phát mỗi khung hình.
 */
function writeMatrix(
  array: Float32Array,
  index: number,
  x: number,
  y: number,
  z: number,
  hx: number,
  hz: number,
  sx: number,
  sy: number,
  sz: number,
  roll: number,
): void {
  const o = index * 16;
  const cos = Math.cos(roll);
  const sin = Math.sin(roll);
  // Cột 0: trục X của mô hình (hướng nhìn).
  array[o] = hx * sx;
  array[o + 1] = 0;
  array[o + 2] = hz * sx;
  array[o + 3] = 0;
  // Cột 1: trục Y của mô hình sau khi nghiêng quanh X.
  array[o + 4] = -hz * sin * sy;
  array[o + 5] = cos * sy;
  array[o + 6] = hx * sin * sy;
  array[o + 7] = 0;
  // Cột 2: trục Z của mô hình sau khi nghiêng quanh X.
  array[o + 8] = -hz * cos * sz;
  array[o + 9] = -sin * sz;
  array[o + 10] = hx * cos * sz;
  array[o + 11] = 0;
  array[o + 12] = x;
  array[o + 13] = y;
  array[o + 14] = z;
  array[o + 15] = 1;
}
