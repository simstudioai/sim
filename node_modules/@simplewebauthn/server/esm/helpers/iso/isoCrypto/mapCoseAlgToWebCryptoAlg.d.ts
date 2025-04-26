import { SubtleCryptoAlg } from './structs.js';
import { COSEALG } from '../../cose.js';
/**
 * Convert a COSE alg ID into a corresponding string value that WebCrypto APIs expect
 */
export declare function mapCoseAlgToWebCryptoAlg(alg: COSEALG): SubtleCryptoAlg;
//# sourceMappingURL=mapCoseAlgToWebCryptoAlg.d.ts.map