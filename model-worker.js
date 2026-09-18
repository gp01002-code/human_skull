import { BufferGeometry, BufferAttribute } from './vendor/three.module.js';
import { MeshBVH } from './vendor/bvh.module.js';

// Parsing and acceleration-tree construction never block pointer input or rendering.
self.onmessage = async ({ data: { file, id } }) => {
  try {
    const response = await fetch(new URL(`models/${file}`, import.meta.url));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    const header = new DataView(buffer);
    const vertices = header.getUint32(0, true), indices = header.getUint32(4, true);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(buffer, 8, vertices * 3).slice(), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(buffer, 8 + vertices * 12, vertices * 3).slice(), 3));
    geometry.setIndex(new BufferAttribute(new Uint32Array(buffer, 8 + vertices * 24, indices).slice(), 1));
    const tree = new MeshBVH(geometry, { maxLeafTris: 10 });
    const serialized = MeshBVH.serialize(tree, { cloneBuffers: false });
    const position = geometry.attributes.position.array;
    const normal = geometry.attributes.normal.array;
    self.postMessage({ id, position, normal, serialized },
      [position.buffer, normal.buffer, serialized.index.buffer, ...serialized.roots]);
  } catch (error) {
    self.postMessage({ id, error: String(error.message || error) });
  }
};
