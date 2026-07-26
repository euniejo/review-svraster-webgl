export type Vec3 = readonly [number, number, number];

const SH_C0 = 0.28209479177387814;
const SH_C1 = 0.4886025119029199;
const SH_C2 = [
  1.0925484305920792,
  -1.0925484305920792,
  0.31539156525252005,
  -1.0925484305920792,
  0.5462742152960396
] as const;
const SH_C3 = [
  -0.5900435899266435,
  2.890611442640554,
  -0.4570457994644658,
  0.3731763325901154,
  -0.4570457994644658,
  1.445305721320277,
  -0.5900435899266435
] as const;

export function getRequiredShRestCount(degree: number): number {
  if (!Number.isInteger(degree) || degree < 0 || degree > 3) {
    throw new Error(`Unsupported SH degree ${degree}; expected an integer from 0 to 3`);
  }
  return ((degree + 1) ** 2 - 1) * 3;
}

export function evaluateSvrasterSh(
  degree: number,
  sh0: Vec3,
  shRest: ArrayLike<number>,
  direction: Vec3
): [number, number, number] {
  const restCount = getRequiredShRestCount(degree);
  if (shRest.length < restCount) {
    throw new Error(`SH degree ${degree} requires ${restCount} rest values, got ${shRest.length}`);
  }

  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (length === 0) {
    throw new Error('SH direction must be non-zero');
  }

  const x = direction[0] / length;
  const y = direction[1] / length;
  const z = direction[2] / length;
  const bases: number[] = [];

  if (degree >= 1) {
    bases.push(-SH_C1 * y, SH_C1 * z, -SH_C1 * x);
  }
  if (degree >= 2) {
    const xx = x * x;
    const yy = y * y;
    const zz = z * z;
    bases.push(
      SH_C2[0] * x * y,
      SH_C2[1] * y * z,
      SH_C2[2] * (2 * zz - xx - yy),
      SH_C2[3] * x * z,
      SH_C2[4] * (xx - yy)
    );
  }
  if (degree >= 3) {
    const xx = x * x;
    const yy = y * y;
    const zz = z * z;
    bases.push(
      SH_C3[0] * y * (3 * xx - yy),
      SH_C3[1] * x * y * z,
      SH_C3[2] * y * (4 * zz - xx - yy),
      SH_C3[3] * z * (2 * zz - 3 * xx - 3 * yy),
      SH_C3[4] * x * (4 * zz - xx - yy),
      SH_C3[5] * z * (xx - yy),
      SH_C3[6] * x * (xx - 3 * yy)
    );
  }

  const color: [number, number, number] = [
    SH_C0 * sh0[0] + 0.5,
    SH_C0 * sh0[1] + 0.5,
    SH_C0 * sh0[2] + 0.5
  ];
  for (let basisIndex = 0; basisIndex < bases.length; basisIndex++) {
    const coefficientOffset = basisIndex * 3;
    color[0] += bases[basisIndex] * shRest[coefficientOffset];
    color[1] += bases[basisIndex] * shRest[coefficientOffset + 1];
    color[2] += bases[basisIndex] * shRest[coefficientOffset + 2];
  }

  color[0] = Math.max(color[0], 0);
  color[1] = Math.max(color[1], 0);
  color[2] = Math.max(color[2], 0);
  return color;
}

// Kept beside the CPU reference so both implementations follow the same convention.
export const SVRASTER_SH_EVALUATION_GLSL = String.raw`
      vec3 evaluateSH(
        vec3 sh0,
        vec3 sh1_0, vec3 sh1_1, vec3 sh1_2,
        vec3 sh2_0, vec3 sh2_1, vec3 sh2_2, vec3 sh2_3, vec3 sh2_4,
        vec3 sh3_0, vec3 sh3_1, vec3 sh3_2, vec3 sh3_3, vec3 sh3_4, vec3 sh3_5, vec3 sh3_6,
        vec3 direction,
        int degree,
        bool disableSh2
      ) {
        vec3 dir = normalize((uInverseTransformMatrix * vec4(direction, 0.0)).xyz);
        vec3 color = sh0 * 0.28209479177387814;

        float basis_neg_y = -0.4886025119029199 * dir.y;
        float basis_z =      0.4886025119029199 * dir.z;
        float basis_neg_x = -0.4886025119029199 * dir.x;
        color += sh1_0 * pick3(basis_neg_y, basis_z, basis_neg_x, uSh1BasisOrder.x);
        color += sh1_1 * pick3(basis_neg_y, basis_z, basis_neg_x, uSh1BasisOrder.y);
        color += sh1_2 * pick3(basis_neg_y, basis_z, basis_neg_x, uSh1BasisOrder.z);

        if (degree >= 2 && !disableSh2) {
          float xx = dir.x * dir.x;
          float yy = dir.y * dir.y;
          float zz = dir.z * dir.z;
          float sh2_basis0 =  1.0925484305920792  * dir.x * dir.y;
          float sh2_basis1 = -1.0925484305920792  * dir.y * dir.z;
          float sh2_basis2 =  0.31539156525252005 * (2.0 * zz - xx - yy);
          float sh2_basis3 = -1.0925484305920792  * dir.x * dir.z;
          float sh2_basis4 =  0.5462742152960396  * (xx - yy);

          color += pick5(sh2_basis0, sh2_basis1, sh2_basis2, sh2_basis3, sh2_basis4, uSh2BasisOrderA.x) * sh2_0;
          color += pick5(sh2_basis0, sh2_basis1, sh2_basis2, sh2_basis3, sh2_basis4, uSh2BasisOrderA.y) * sh2_1;
          color += pick5(sh2_basis0, sh2_basis1, sh2_basis2, sh2_basis3, sh2_basis4, uSh2BasisOrderA.z) * sh2_2;
          color += pick5(sh2_basis0, sh2_basis1, sh2_basis2, sh2_basis3, sh2_basis4, uSh2BasisOrderA.w) * sh2_3;
          color += pick5(sh2_basis0, sh2_basis1, sh2_basis2, sh2_basis3, sh2_basis4, uSh2BasisOrderB) * sh2_4;
        }

        if (degree >= 3) {
          float xx = dir.x * dir.x;
          float yy = dir.y * dir.y;
          float zz = dir.z * dir.z;
          float sh3_basis0 = -0.5900435899266435 * dir.y * (3.0 * xx - yy);
          float sh3_basis1 =  2.890611442640554  * dir.x * dir.y * dir.z;
          float sh3_basis2 = -0.4570457994644658 * dir.y * (4.0 * zz - xx - yy);
          float sh3_basis3 =  0.3731763325901154 * dir.z * (2.0 * zz - 3.0 * xx - 3.0 * yy);
          float sh3_basis4 = -0.4570457994644658 * dir.x * (4.0 * zz - xx - yy);
          float sh3_basis5 =  1.445305721320277  * dir.z * (xx - yy);
          float sh3_basis6 = -0.5900435899266435 * dir.x * (xx - 3.0 * yy);

          color += sh3_0 * sh3_basis0;
          color += sh3_1 * sh3_basis1;
          color += sh3_2 * sh3_basis2;
          color += sh3_3 * sh3_basis3;
          color += sh3_4 * sh3_basis4;
          color += sh3_5 * sh3_basis5;
          color += sh3_6 * sh3_basis6;
        }

        return max(color + 0.5, 0.0);
      }
`;
