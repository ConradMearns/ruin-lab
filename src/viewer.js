import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** Instanced voxel renderer; materials and instance buffers are disposed on every update. */
export class VoxelViewer {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#e9ecdf');
    this.scene.fog = new THREE.Fog('#e9ecdf', 125, 260);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', '3D voxel diorama. Drag to orbit, right-drag to pan, scroll to zoom.');
    this.renderer.domElement.setAttribute('role', 'img');
    this.camera = new THREE.OrthographicCamera(-30, 30, 30, -30, 0.1, 500);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minZoom = 0.35;
    this.controls.maxZoom = 5;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.rotateSpeed = 0.6;
    this.controls.addEventListener('change', () => this.invalidate());
    const ambient = new THREE.HemisphereLight('#f7f9ec', '#8b917a', 2.7);
    this.scene.add(ambient);
    this.sun = new THREE.DirectionalLight('#fff6dc', 3.2);
    this.sun.position.set(-35, 65, 30);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.normalBias = 0.045;
    this.sun.shadow.bias = -0.00015;
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 220;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);
    const fill = new THREE.DirectionalLight('#e6eddb', 0.5);
    fill.position.set(30, 20, -40); this.scene.add(fill);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshStandardMaterial({ color: '#e9ecdf', roughness: 1 }));
    this.ground.rotation.x = -Math.PI / 2; this.ground.position.y = -0.56; this.ground.receiveShadow = true; this.scene.add(this.ground);
    this.grid = new THREE.GridHelper(180, 90, '#bfc9ac', '#cdd5be');
    this.grid.position.y = -0.54; this.grid.material.transparent = true; this.grid.material.opacity = 0.2; this.grid.material.depthWrite = false; this.scene.add(this.grid);
    this.voxelGroup = new THREE.Group(); this.scene.add(this.voxelGroup);
    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.structure = null;
    this.viewMode = 'orbit'; this.frustum = 30; this.dirty = true;
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      if (this.dirty) { this.renderer.render(this.scene, this.camera); this.dirty = false; }
    });
    this.renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); this.onError?.('The 3D context was lost. Reload the page to restore the viewer.'); });
  }
  invalidate() { this.dirty = true; }
  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h); const aspect = w / h;
    const [W, , D] = this.structure?.size || [28, 28, 28];
    const vertical = Math.max(this.frustum, (W + D) * 0.43 / aspect);
    this.camera.left = -vertical * aspect; this.camera.right = vertical * aspect;
    this.camera.top = vertical; this.camera.bottom = -vertical;
    this.camera.updateProjectionMatrix(); this.invalidate();
  }
  clearVoxels() {
    for (const child of [...this.voxelGroup.children]) { this.voxelGroup.remove(child); child.material.dispose(); child.dispose(); }
  }
  setStructure(structure, voxels = structure.voxels, reset = false) {
    this.clearVoxels(); this.structure = structure;
    const [W, , D] = structure.size;
    const batches = new Map();
    for (const v of voxels) { if (!Number(v[3])) continue; if (!batches.has(v[3])) batches.set(v[3], []); batches.get(v[3]).push(v); }
    const dummy = new THREE.Object3D(); const color = new THREE.Color();
    for (const [id, list] of batches) {
      const mat = structure.materials[id];
      const opacity = mat.previewOpacity ?? 1;
      const mesh = new THREE.InstancedMesh(this.geometry, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, metalness: 0, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 }), list.length);
      mesh.castShadow = opacity >= 1; mesh.receiveShadow = opacity >= 1;
      const baseColor = new THREE.Color(mat.color || '#8a8a85');
      for (let i = 0; i < list.length; i++) {
        const [x, y, z] = list[i];
        const hash = ((Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663) ^ Math.imul(z + 1, 83492791)) >>> 0) / 4294967295;
        let sx = 0.985, sy = 0.985, sz = 0.985, oy = 0;
        if (mat.previewScale) { sx = mat.previewScale; sy = mat.previewScale; sz = mat.previewScale; }
        if (mat.loose) { sx = 0.7 + hash * 0.25; sy = 0.55 + hash * 0.3; sz = 0.7 + (1 - hash) * 0.2; oy = (sy - 1) / 2; }
        if (mat.organic) {
          if (mat.render === 'moss') { sx = 0.87; sy = 0.18; sz = 0.87; }
          else if (mat.render === 'vine') { sx = 0.58; sy = 0.8; sz = 0.58; }
          else { sx = 0.28 + hash * 0.25; sy = 0.22 + hash * 0.4; sz = 0.3 + hash * 0.25; }
          oy = (sy - 1) / 2;
        }
        dummy.position.set(x - (W - 1) / 2, y + oy, z - (D - 1) / 2);
        dummy.scale.set(sx, sy, sz); dummy.rotation.set(0, mat.loose ? hash * 0.35 : 0, 0); dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        color.copy(baseColor).multiplyScalar(0.88 + hash * 0.2); mesh.setColorAt(i, color);
      }
      mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; mesh.computeBoundingSphere(); this.voxelGroup.add(mesh);
    }
    if (reset) this.fit(); this.invalidate();
  }
  fit(mode = 'orbit') {
    if (!this.structure) return;
    const [W, H, D] = this.structure.size;
    const highest = this.structure.voxels.reduce((max, v) => Math.max(max, v[1]), 1);
    const extent = Math.max(W, D, highest * 1.1);
    this.frustum = extent * 0.76;
    this.camera.zoom = 1;
    this.controls.target.set(0, highest * 0.37, 0);
    if (mode === 'top') { this.camera.position.set(0.01, extent * 3, 0.01); this.camera.up.set(0, 0, -1); }
    else { this.camera.up.set(0, 1, 0); this.camera.position.set(extent * 1.5, highest * 0.37 + extent * 1.1, extent * 1.65); }
    this.viewMode = mode;
    this.camera.lookAt(this.controls.target); this.controls.update();
    const radius = Math.max(W, H, D) * 1.1;
    Object.assign(this.sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, far: radius * 6 });
    this.sun.position.set(-radius, radius * 2, radius); this.sun.target.position.set(0, highest / 3, 0); this.sun.shadow.camera.updateProjectionMatrix();
    this.resize();
  }
  /** Presentation only: Y=0 is just below the bottom voxel course. */
  setFloorHeight(height = 0) {
    if (!Number.isFinite(height)) return;
    this.ground.position.y = height - 0.56;
    this.grid.position.y = height - 0.54;
    this.invalidate();
  }
  setGrid(visible) { this.grid.visible = visible; this.invalidate(); }
  async snapshot() {
    this.renderer.render(this.scene, this.camera);
    return new Promise(resolve => this.renderer.domElement.toBlob(resolve, 'image/png'));
  }
  dispose() {
    this.observer.disconnect(); this.renderer.setAnimationLoop(null); this.controls.dispose(); this.clearVoxels();
    this.geometry.dispose(); this.ground.geometry.dispose(); this.ground.material.dispose(); this.grid.geometry.dispose(); this.grid.material.dispose(); this.renderer.dispose();
  }
}
