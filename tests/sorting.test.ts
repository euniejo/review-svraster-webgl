import assert from 'node:assert/strict';
import test from 'node:test';

import { MortonSorter } from '../src/lib/MortonSorter.ts';
import { ViewDepthSorter } from '../src/lib/ViewDepthSorter.ts';

test('view-depth sorting is back-to-front along the camera direction', () => {
  const positions = new Float32Array([
    0, 0, -10,
    100, 0, -5,
    0, 0, -2
  ]);

  const sorted = ViewDepthSorter.sortVoxels(positions, [0, 0, 0], [0, 0, -1]);
  assert.deepEqual(Array.from(sorted), [0, 1, 2]);
});

test('view-depth sorting follows a rotated camera', () => {
  const positions = new Float32Array([
    2, 0, 0,
    8, 30, 0,
    5, 0, 0
  ]);

  const sorted = ViewDepthSorter.sortVoxels(positions, [0, 0, 0], [1, 0, 0]);
  assert.deepEqual(Array.from(sorted), [1, 2, 0]);
});

test('view-depth sorting handles empty data and rejects an invalid camera', () => {
  assert.deepEqual(
    Array.from(ViewDepthSorter.sortVoxels(new Float32Array(), [0, 0, 0], [0, 0, 0])),
    []
  );
  assert.throws(
    () => ViewDepthSorter.sortVoxels(new Float32Array([0, 0, 0]), [1, 2, 3], [1, 2, 3]),
    /Camera position and target must differ/
  );
});

test('octpath reconstruction preserves all 48 bits', () => {
  const paths = MortonSorter.encodeOctpathsFromPositions(
    new Float32Array([
      -0.5, -0.5, -0.5,
      0.5, 0.5, 0.5
    ]),
    new Uint8Array([1, 1]),
    [0, 0, 0],
    2
  );

  assert.deepEqual(Array.from(paths.low), [0, 0]);
  assert.deepEqual(Array.from(paths.high), [0, 0xe000]);
});

test('Morton order uses the SVRaster repeated-quadrant XOR rank', () => {
  const positions = new Float32Array([
    -0.5, -0.5, -0.5,
    0.5, 0.5, 0.5
  ]);
  const low = new Uint32Array([0, 0]);
  const high = new Uint32Array([0, 0xe000]);

  assert.deepEqual(
    Array.from(MortonSorter.sortVoxels(positions, [-2, -2, -2], low, high)),
    [0, 1]
  );
  assert.deepEqual(
    Array.from(MortonSorter.sortVoxels(positions, [2, 2, 2], low, high)),
    [1, 0]
  );
  assert.deepEqual(MortonSorter.computeOrderRank(0, 0, 7), [0xffffffff, 0xffff]);
});
