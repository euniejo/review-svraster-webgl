export class ViewDepthSorter {
  private static readonly BUCKET_COUNT = 256 * 256;

  static sortVoxels(
    positions: Float32Array,
    cameraPosition: [number, number, number],
    cameraTarget: [number, number, number]
  ): Uint32Array {
    const voxelCount = positions.length / 3;
    const indices = new Uint32Array(voxelCount);
    if (voxelCount === 0) {
      return indices;
    }

    let dirX = cameraTarget[0] - cameraPosition[0];
    let dirY = cameraTarget[1] - cameraPosition[1];
    let dirZ = cameraTarget[2] - cameraPosition[2];
    const dirLength = Math.hypot(dirX, dirY, dirZ);
    if (dirLength === 0) {
      throw new Error('Camera position and target must differ for depth sorting');
    }
    dirX /= dirLength;
    dirY /= dirLength;
    dirZ /= dirLength;

    const depths = new Float32Array(voxelCount);
    let minDepth = Infinity;
    let maxDepth = -Infinity;
    for (let index = 0; index < voxelCount; index++) {
      const offset = index * 3;
      const depth =
        (positions[offset] - cameraPosition[0]) * dirX +
        (positions[offset + 1] - cameraPosition[1]) * dirY +
        (positions[offset + 2] - cameraPosition[2]) * dirZ;
      depths[index] = depth;
      minDepth = Math.min(minDepth, depth);
      maxDepth = Math.max(maxDepth, depth);
    }

    const counts = new Uint32Array(this.BUCKET_COUNT);
    const bucketScale = (this.BUCKET_COUNT - 1) / (maxDepth - minDepth || 1);
    for (let index = 0; index < voxelCount; index++) {
      const bucket = Math.min(
        this.BUCKET_COUNT - 1,
        Math.max(0, Math.floor((depths[index] - minDepth) * bucketScale))
      );
      counts[bucket]++;
    }

    const starts = new Uint32Array(this.BUCKET_COUNT);
    let outputOffset = 0;
    for (let bucket = this.BUCKET_COUNT - 1; bucket >= 0; bucket--) {
      starts[bucket] = outputOffset;
      outputOffset += counts[bucket];
    }

    counts.fill(0);
    for (let index = 0; index < voxelCount; index++) {
      const bucket = Math.min(
        this.BUCKET_COUNT - 1,
        Math.max(0, Math.floor((depths[index] - minDepth) * bucketScale))
      );
      indices[starts[bucket] + counts[bucket]] = index;
      counts[bucket]++;
    }

    return indices;
  }
}
