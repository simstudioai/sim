"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapCoseAlgToWebCryptoKeyAlgName = mapCoseAlgToWebCryptoKeyAlgName;
const cose_js_1 = require("../../cose.js");
/**
 * Convert a COSE alg ID into a corresponding key algorithm string value that WebCrypto APIs expect
 */
function mapCoseAlgToWebCryptoKeyAlgName(alg) {
    if ([cose_js_1.COSEALG.EdDSA].indexOf(alg) >= 0) {
        return 'Ed25519';
    }
    else if ([cose_js_1.COSEALG.ES256, cose_js_1.COSEALG.ES384, cose_js_1.COSEALG.ES512, cose_js_1.COSEALG.ES256K].indexOf(alg) >= 0) {
        return 'ECDSA';
    }
    else if ([cose_js_1.COSEALG.RS256, cose_js_1.COSEALG.RS384, cose_js_1.COSEALG.RS512, cose_js_1.COSEALG.RS1].indexOf(alg) >= 0) {
        return 'RSASSA-PKCS1-v1_5';
    }
    else if ([cose_js_1.COSEALG.PS256, cose_js_1.COSEALG.PS384, cose_js_1.COSEALG.PS512].indexOf(alg) >= 0) {
        return 'RSA-PSS';
    }
    throw new Error(`Could not map COSE alg value of ${alg} to a WebCrypto key alg name`);
}
