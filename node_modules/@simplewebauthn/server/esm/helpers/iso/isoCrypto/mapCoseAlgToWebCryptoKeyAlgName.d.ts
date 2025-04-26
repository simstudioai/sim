import { COSEALG } from '../../cose.js';
import { SubtleCryptoKeyAlgName } from './structs.js';
/**
 * Convert a COSE alg ID into a corresponding key algorithm string value that WebCrypto APIs expect
 */
export declare function mapCoseAlgToWebCryptoKeyAlgName(alg: COSEALG): SubtleCryptoKeyAlgName;
//# sourceMappingURL=mapCoseAlgToWebCryptoKeyAlgName.d.ts.map