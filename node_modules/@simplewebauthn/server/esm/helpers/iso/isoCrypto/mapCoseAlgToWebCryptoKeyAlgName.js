import { COSEALG } from '../../cose.js';
/**
 * Convert a COSE alg ID into a corresponding key algorithm string value that WebCrypto APIs expect
 */
export function mapCoseAlgToWebCryptoKeyAlgName(alg) {
    if ([COSEALG.EdDSA].indexOf(alg) >= 0) {
        return 'Ed25519';
    }
    else if ([COSEALG.ES256, COSEALG.ES384, COSEALG.ES512, COSEALG.ES256K].indexOf(alg) >= 0) {
        return 'ECDSA';
    }
    else if ([COSEALG.RS256, COSEALG.RS384, COSEALG.RS512, COSEALG.RS1].indexOf(alg) >= 0) {
        return 'RSASSA-PKCS1-v1_5';
    }
    else if ([COSEALG.PS256, COSEALG.PS384, COSEALG.PS512].indexOf(alg) >= 0) {
        return 'RSA-PSS';
    }
    throw new Error(`Could not map COSE alg value of ${alg} to a WebCrypto key alg name`);
}
