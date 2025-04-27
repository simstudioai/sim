import { COSEALG } from '../../cose.js';
/**
 * Convert a COSE alg ID into a corresponding string value that WebCrypto APIs expect
 */
export function mapCoseAlgToWebCryptoAlg(alg) {
    if ([COSEALG.RS1].indexOf(alg) >= 0) {
        return 'SHA-1';
    }
    else if ([COSEALG.ES256, COSEALG.PS256, COSEALG.RS256].indexOf(alg) >= 0) {
        return 'SHA-256';
    }
    else if ([COSEALG.ES384, COSEALG.PS384, COSEALG.RS384].indexOf(alg) >= 0) {
        return 'SHA-384';
    }
    else if ([COSEALG.ES512, COSEALG.PS512, COSEALG.RS512, COSEALG.EdDSA].indexOf(alg) >=
        0) {
        return 'SHA-512';
    }
    throw new Error(`Could not map COSE alg value of ${alg} to a WebCrypto alg`);
}
