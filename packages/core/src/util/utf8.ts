/**
 * 与运行环境无关的 UTF-8 / 十六进制编解码。
 *
 * 不用 `TextEncoder` / `TextDecoder`、不用 `Buffer`：
 * Vela QuickApp 是否暴露这些并不确定，而这几段代码本身很短，
 * 自己实现能保证在任何 JS 运行时里行为一致。
 */

/**
 * 字符串 → UTF-8 字节。
 * 孤立代理项按 U+FFFD 处理，与 WHATWG 编码标准一致。
 */
export function utf8Encode(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        const cp = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        out.push(
          0xf0 | (cp >>> 18),
          0x80 | ((cp >>> 12) & 0x3f),
          0x80 | ((cp >>> 6) & 0x3f),
          0x80 | (cp & 0x3f),
        );
        i += 1;
        continue;
      }
      out.push(0xef, 0xbf, 0xbd);
      continue;
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      out.push(0xef, 0xbf, 0xbd);
      continue;
    }

    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >>> 6), 0x80 | (code & 0x3f));
    } else {
      out.push(0xe0 | (code >>> 12), 0x80 | ((code >>> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return out;
}

/**
 * UTF-8 字节 → 字符串。
 * 非法序列按 U+FFFD 替换，不抛错——面对外部数据时这比抛错更实用。
 */
export function utf8Decode(bytes: ArrayLike<number>): string {
  let out = '';
  let i = 0;

  while (i < bytes.length) {
    const b0 = bytes[i]! & 0xff;
    i += 1;

    let cp: number;
    let extra: number;

    if (b0 < 0x80) {
      cp = b0;
      extra = 0;
    } else if (b0 >= 0xc2 && b0 <= 0xdf) {
      cp = b0 & 0x1f;
      extra = 1;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      cp = b0 & 0x0f;
      extra = 2;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      cp = b0 & 0x07;
      extra = 3;
    } else {
      out += '\uFFFD';
      continue;
    }

    let valid = true;
    for (let k = 0; k < extra; k += 1) {
      if (i >= bytes.length) {
        valid = false;
        break;
      }
      const b = bytes[i]! & 0xff;
      if ((b & 0xc0) !== 0x80) {
        valid = false;
        break;
      }
      cp = (cp << 6) | (b & 0x3f);
      i += 1;
    }

    if (!valid) {
      out += '\uFFFD';
      continue;
    }

    // 拒绝过长编码与越界码点
    const overlong =
      (extra === 1 && cp < 0x80) ||
      (extra === 2 && cp < 0x800) ||
      (extra === 3 && cp < 0x10000);
    if (overlong || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      out += '\uFFFD';
      continue;
    }

    if (cp <= 0xffff) {
      out += String.fromCharCode(cp);
    } else {
      const v = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (v >>> 10), 0xdc00 + (v & 0x3ff));
    }
  }

  return out;
}

/** 十六进制字符串 → 字节数组；非法输入返回 null。 */
export function hexToBytes(hex: string): number[] | null {
  if (hex.length === 0 || hex.length % 2 !== 0) return null;
  const out: number[] = new Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (!Number.isFinite(byte)) return null;
    out[i] = byte;
  }
  return out;
}

/** 字节数组 → 小写十六进制字符串。 */
export function bytesToHex(bytes: ArrayLike<number>): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += (bytes[i]! & 0xff).toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * 十六进制编码的 UTF-8 文本 → 字符串。
 * 解不出来（非法十六进制或非法 UTF-8）返回 null，交由调用方决定降级策略。
 */
export function decodeHexUtf8(hex: string): string | null {
  const bytes = hexToBytes(hex);
  if (bytes === null) return null;
  const text = utf8Decode(bytes);
  return text.includes('\uFFFD') ? null : text;
}
