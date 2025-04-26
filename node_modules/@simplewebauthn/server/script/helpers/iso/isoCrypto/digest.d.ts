import { COSEALG } from '../../cose.js';
/**
 * Generate a digest of the provided data.
 *
 * @param data The data to generate a digest of
 * @param algorithm A COSE algorithm ID that maps to a desired SHA algorithm
 */
export declare function digest(data: Uint8Array, algorithm: COSEALG): Promise<Uint8Array>;
//# sourceMappingURL=digest.d.ts.map