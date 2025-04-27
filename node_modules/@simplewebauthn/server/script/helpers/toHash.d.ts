import { COSEALG } from './cose.js';
/**
 * Returns hash digest of the given data, using the given algorithm when provided. Defaults to using
 * SHA-256.
 */
export declare function toHash(data: Uint8Array | string, algorithm?: COSEALG): Promise<Uint8Array>;
//# sourceMappingURL=toHash.d.ts.map