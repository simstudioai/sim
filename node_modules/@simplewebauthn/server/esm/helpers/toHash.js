import { isoCrypto, isoUint8Array } from './iso/index.js';
/**
 * Returns hash digest of the given data, using the given algorithm when provided. Defaults to using
 * SHA-256.
 */
export function toHash(data, algorithm = -7) {
    if (typeof data === 'string') {
        data = isoUint8Array.fromUTF8String(data);
    }
    const digest = isoCrypto.digest(data, algorithm);
    return digest;
}
