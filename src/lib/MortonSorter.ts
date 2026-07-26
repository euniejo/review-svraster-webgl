const MAX_OCTREE_LEVELS = 16;
const LOW_WORD_SCALE = 0x100000000;
const RADIX_SIZE = 1 << 16;

export interface SplitOctpaths {
  low: Uint32Array;
  high: Uint32Array;
}

/** Implements SVRaster's 48-bit `octpath ^ repeated_quadrant` order rank. */
export class MortonSorter {
  private static readonly quadrantMaskLow = new Uint32Array(8);
  private static readonly quadrantMaskHigh = new Uint32Array(8);
  private static masksInitialized = false;

  private static initializeMasks(): void {
    if (this.masksInitialized) {
      return;
    }

    for (let quadrant = 0; quadrant < 8; quadrant++) {
      let mask = 0;
      for (let level = 0; level < MAX_OCTREE_LEVELS; level++) {
        mask = mask * 8 + quadrant;
      }
      this.quadrantMaskLow[quadrant] = mask >>> 0;
      this.quadrantMaskHigh[quadrant] = Math.floor(mask / LOW_WORD_SCALE) >>> 0;
    }
    this.masksInitialized = true;
  }

  static getRayQuadrantId(direction: [number, number, number]): number {
    return (direction[0] < 0 ? 4 : 0) |
      (direction[1] < 0 ? 2 : 0) |
      (direction[2] < 0 ? 1 : 0);
  }

  static computeOrderRank(low: number, high: number, quadrant: number): [number, number] {
    this.initializeMasks();
    return [
      (low ^ this.quadrantMaskLow[quadrant]) >>> 0,
      (high ^ this.quadrantMaskHigh[quadrant]) >>> 0
    ];
  }

  static encodeOctpathsFromPositions(
    positions: Float32Array,
    octlevels: Uint8Array,
    sceneCenter: [number, number, number],
    sceneExtent: number
  ): SplitOctpaths {
    const voxelCount = positions.length / 3;
    if (!Number.isInteger(voxelCount) || octlevels.length !== voxelCount) {
      throw new Error('Position and octlevel counts must match');
    }

    const low = new Uint32Array(voxelCount);
    const high = new Uint32Array(voxelCount);
    const sceneMinX = sceneCenter[0] - sceneExtent * 0.5;
    const sceneMinY = sceneCenter[1] - sceneExtent * 0.5;
    const sceneMinZ = sceneCenter[2] - sceneExtent * 0.5;

    for (let index = 0; index < voxelCount; index++) {
      const level = octlevels[index];
      const voxelSize = sceneExtent * Math.pow(2, -level);
      const offset = index * 3;
      const x = Math.round((positions[offset] - sceneMinX) / voxelSize - 0.5);
      const y = Math.round((positions[offset + 1] - sceneMinY) / voxelSize - 0.5);
      const z = Math.round((positions[offset + 2] - sceneMinZ) / voxelSize - 0.5);

      let path = 0;
      for (let depth = 0; depth < level; depth++) {
        const coordinateBit = level - depth - 1;
        const child =
          (((x >> coordinateBit) & 1) << 2) |
          (((y >> coordinateBit) & 1) << 1) |
          ((z >> coordinateBit) & 1);
        path += child * Math.pow(2, 3 * (MAX_OCTREE_LEVELS - depth - 1));
      }

      low[index] = path >>> 0;
      high[index] = Math.floor(path / LOW_WORD_SCALE) >>> 0;
    }

    return { low, high };
  }

  static sortVoxels(
    positions: Float32Array,
    cameraPosition: [number, number, number],
    octpathLow: Uint32Array,
    octpathHigh: Uint32Array
  ): Uint32Array {
    const voxelCount = positions.length / 3;
    if (octpathLow.length !== voxelCount || octpathHigh.length !== voxelCount) {
      throw new Error('Morton sorting requires one complete 48-bit octpath per voxel');
    }
    if (voxelCount === 0) {
      return new Uint32Array();
    }

    this.initializeMasks();
    const rankLow = new Uint32Array(voxelCount);
    const rankHigh = new Uint32Array(voxelCount);
    for (let index = 0; index < voxelCount; index++) {
      const offset = index * 3;
      const quadrant = this.getRayQuadrantId([
        positions[offset] - cameraPosition[0],
        positions[offset + 1] - cameraPosition[1],
        positions[offset + 2] - cameraPosition[2]
      ]);
      rankLow[index] = (octpathLow[index] ^ this.quadrantMaskLow[quadrant]) >>> 0;
      rankHigh[index] = (octpathHigh[index] ^ this.quadrantMaskHigh[quadrant]) >>> 0;
    }

    let source = new Uint32Array(voxelCount);
    let target = new Uint32Array(voxelCount);
    for (let index = 0; index < voxelCount; index++) {
      source[index] = index;
    }

    const counts = new Uint32Array(RADIX_SIZE);
    const starts = new Uint32Array(RADIX_SIZE);
    for (let pass = 0; pass < 3; pass++) {
      counts.fill(0);
      for (let index = 0; index < voxelCount; index++) {
        const voxel = source[index];
        const digit = pass === 0
          ? rankLow[voxel] & 0xffff
          : pass === 1 ? rankLow[voxel] >>> 16 : rankHigh[voxel] & 0xffff;
        counts[digit]++;
      }

      let offset = 0;
      for (let digit = 0; digit < RADIX_SIZE; digit++) {
        starts[digit] = offset;
        offset += counts[digit];
      }
      counts.fill(0);

      for (let index = 0; index < voxelCount; index++) {
        const voxel = source[index];
        const digit = pass === 0
          ? rankLow[voxel] & 0xffff
          : pass === 1 ? rankLow[voxel] >>> 16 : rankHigh[voxel] & 0xffff;
        target[starts[digit] + counts[digit]++] = voxel;
      }

      [source, target] = [target, source];
    }

    return source;
  }
}
