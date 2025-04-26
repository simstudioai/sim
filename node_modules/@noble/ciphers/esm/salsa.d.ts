import { Cipher } from './utils.js';
/**
 * hsalsa hashing function, used primarily in xsalsa, to hash
 * key and nonce into key' and nonce'.
 * Same as salsaCore, but there doesn't seem to be a way to move the block
 * out without 25% performance hit.
 */
export declare function hsalsa(s: Uint32Array, k: Uint32Array, i: Uint32Array, o32: Uint32Array): void;
/**
 * Salsa20 from original paper.
 * With 12-byte nonce, it's not safe to use fill it with random (CSPRNG), due to collision chance.
 */
export declare const salsa20: import("./utils.js").XorStream;
/**
 * xsalsa20 eXtended-nonce salsa.
 * With 24-byte nonce, it's safe to use fill it with random (CSPRNG).
 */
export declare const xsalsa20: import("./utils.js").XorStream;
/**
 * xsalsa20-poly1305 eXtended-nonce salsa.
 * With 24-byte nonce, it's safe to use fill it with random (CSPRNG).
 * Also known as secretbox from libsodium / nacl.
 */
export declare const xsalsa20poly1305: ((key: Uint8Array, nonce: Uint8Array) => Cipher) & {
    blockSize: number;
    nonceLength: number;
    tagLength: number;
};
/**
 * Alias to xsalsa20poly1305, for compatibility with libsodium / nacl
 */
export declare function secretbox(key: Uint8Array, nonce: Uint8Array): {
    seal: (plaintext: Uint8Array) => Uint8Array;
    open: (ciphertext: Uint8Array) => Uint8Array;
};
//# sourceMappingURL=salsa.d.ts.map