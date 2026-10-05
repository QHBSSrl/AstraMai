/**
 * GF(256) 上的 Reed–Solomon 纠错。
 *
 * QR 使用的本原多项式是 x^8 + x^4 + x^3 + x^2 + 1（即 0x11D）。
 */

/** GF(256) 乘法。用移位 + 约简实现，避免预计算表带来的初始化开销——QR 编码本来就不热。 */
export function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    // z *= 2，必要时对本原多项式取模
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/**
 * 生成 Reed–Solomon 生成多项式的系数（不含首项 1）。
 *
 * @param degree 纠错码字数
 */
export function rsGeneratorPolynomial(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;

  // 逐次乘以 (x - α^i)
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = gfMultiply(result[j]!, root);
      if (j + 1 < degree) result[j] = result[j]! ^ result[j + 1]!;
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

/**
 * 计算数据码字的 RS 余数（即纠错码字）。
 *
 * @param data 数据码字
 * @param divisor 由 {@link rsGeneratorPolynomial} 得到的生成多项式系数
 */
export function rsRemainder(data: ArrayLike<number>, divisor: readonly number[]): number[] {
  const result = divisor.map(() => 0);

  for (let i = 0; i < data.length; i += 1) {
    const factor = (data[i]! ^ result.shift()!) & 0xff;
    result.push(0);
    for (let j = 0; j < divisor.length; j += 1) {
      result[j] = result[j]! ^ gfMultiply(divisor[j]!, factor);
    }
  }
  return result;
}
