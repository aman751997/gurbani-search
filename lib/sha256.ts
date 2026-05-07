// Pure-JS synchronous SHA-256 (FIPS 180-4). Used for cache keys in captionCache.ts.
//
// Uses a pure-JS impl rather than node:crypto because this module must run on
// the Vercel Edge runtime, which forbids `node:*` builtins. crypto.subtle is
// available on Edge but is async, and our call-sites need a sync hash for small inputs.
//
// Adapted from the public-domain FIPS 180-4 reference. Verified against the
// empty-string and "abc" test vectors.

// Initial hash values (FIPS 180-4)
const H0: readonly number[] = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

// Round constants (FIPS 180-4)
const K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function utf8Bytes(s: string): Uint8Array {
  // TextEncoder is available on Node 20+ and Edge.
  return new TextEncoder().encode(s);
}

/**
 * SHA-256 digest of the input UTF-8 string, returned as lowercase hex.
 *
 * Sync. O(n) on input length. Suitable for small inputs (queries).
 */
export function sha256Hex(input: string): string {
  const msg = utf8Bytes(input);
  const bitLen = msg.length * 8;

  // Padding: append 0x80, then zeros, then 64-bit big-endian length, to
  // align on 512-bit blocks.
  const padLen =
    (msg.length + 9) % 64 === 0
      ? 0
      : 64 - ((msg.length + 9) % 64);
  const paddedLen = msg.length + 1 + padLen + 8;
  const buf = new Uint8Array(paddedLen);
  buf.set(msg, 0);
  buf[msg.length] = 0x80;
  // Write bit length as big-endian 64-bit at buf[paddedLen - 8 .. paddedLen].
  // bitLen fits safely in a double for inputs ≪ 2^53 bytes.
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  buf[paddedLen - 8] = (hi >>> 24) & 0xff;
  buf[paddedLen - 7] = (hi >>> 16) & 0xff;
  buf[paddedLen - 6] = (hi >>> 8) & 0xff;
  buf[paddedLen - 5] = hi & 0xff;
  buf[paddedLen - 4] = (lo >>> 24) & 0xff;
  buf[paddedLen - 3] = (lo >>> 16) & 0xff;
  buf[paddedLen - 2] = (lo >>> 8) & 0xff;
  buf[paddedLen - 1] = lo & 0xff;

  const H = [...H0];
  const W = new Array<number>(64);

  for (let chunk = 0; chunk < paddedLen; chunk += 64) {
    for (let i = 0; i < 16; i++) {
      const j = chunk + i * 4;
      W[i] =
        ((buf[j] << 24) |
          (buf[j + 1] << 16) |
          (buf[j + 2] << 8) |
          buf[j + 3]) >>>
        0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 =
        rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 =
        rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }

    let a = H[0],
      b = H[1],
      c = H[2],
      d = H[3],
      e = H[4],
      f = H[5],
      g = H[6],
      h = H[7];

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  let hex = "";
  for (let i = 0; i < 8; i++) {
    hex += H[i].toString(16).padStart(8, "0");
  }
  return hex;
}

export const __TEST__ = { H0, K };
