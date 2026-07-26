import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateSvrasterSh,
  getRequiredShRestCount,
  SVRASTER_SH_EVALUATION_GLSL
} from '../src/lib/SphericalHarmonics.ts';

const EPSILON = 1e-12;

function assertVecClose(actual: readonly number[], expected: readonly number[]): void {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index++) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) <= EPSILON,
      `component ${index}: expected ${expected[index]}, got ${actual[index]}`
    );
  }
}

test('degree-to-coefficient counts match SVRaster', () => {
  assert.equal(getRequiredShRestCount(0), 0);
  assert.equal(getRequiredShRestCount(1), 9);
  assert.equal(getRequiredShRestCount(2), 24);
  assert.equal(getRequiredShRestCount(3), 45);
  assert.throws(() => getRequiredShRestCount(1.5), /Unsupported SH degree/);
  assert.throws(() => getRequiredShRestCount(4), /Unsupported SH degree/);
});

test('SH1 uses the canonical -y, +z, -x order', () => {
  const rest = new Float64Array(9);
  rest[0] = 0.2;
  rest[1] = 0.2;
  rest[2] = 0.2;

  assertVecClose(
    evaluateSvrasterSh(1, [0, 0, 0], rest, [0, 5, 0]),
    [0.402279497619416, 0.402279497619416, 0.402279497619416]
  );
});

test('SH2 uses negative yz and xz coefficients', () => {
  const yzRest = new Float64Array(24);
  yzRest[12] = 0.2;
  const inverseSqrt2 = 1 / Math.sqrt(2);
  assertVecClose(
    evaluateSvrasterSh(2, [0, 0, 0], yzRest, [0, inverseSqrt2, inverseSqrt2]),
    [0.3907451569407921, 0.5, 0.5]
  );

  const xzRest = new Float64Array(24);
  xzRest[18] = 0.2;
  assertVecClose(
    evaluateSvrasterSh(2, [0, 0, 0], xzRest, [inverseSqrt2, 0, inverseSqrt2]),
    [0.3907451569407921, 0.5, 0.5]
  );
});

test('SH3 coefficient order matches the seven degree-three bases', () => {
  const rest = new Float64Array(45);
  rest[36] = 0.2;
  rest[43] = 0.2;

  assertVecClose(
    evaluateSvrasterSh(3, [0, 0, 0], rest, [1, 0, 0]),
    [0.5914091598928932, 0.3819912820146713, 0.5]
  );
});

test('the generated GLSL retains the canonical signs', () => {
  assert.match(SVRASTER_SH_EVALUATION_GLSL, /-0\.4886025119029199 \* dir\.y/);
  assert.match(SVRASTER_SH_EVALUATION_GLSL, /-0\.4886025119029199 \* dir\.x/);
  assert.match(SVRASTER_SH_EVALUATION_GLSL, /-1\.0925484305920792\s+\* dir\.y \* dir\.z/);
  assert.match(SVRASTER_SH_EVALUATION_GLSL, /-1\.0925484305920792\s+\* dir\.x \* dir\.z/);
  assert.match(SVRASTER_SH_EVALUATION_GLSL, /float sh3_basis6 = -0\.5900435899266435/);
});
