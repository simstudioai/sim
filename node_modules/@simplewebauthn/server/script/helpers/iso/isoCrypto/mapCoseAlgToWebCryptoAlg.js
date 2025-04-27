"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapCoseAlgToWebCryptoAlg = mapCoseAlgToWebCryptoAlg;
const cose_js_1 = require("../../cose.js");
/**
 * Convert a COSE alg ID into a corresponding string value that WebCrypto APIs expect
 */
function mapCoseAlgToWebCryptoAlg(alg) {
    if ([cose_js_1.COSEALG.RS1].indexOf(alg) >= 0) {
        return 'SHA-1';
    }
    else if ([cose_js_1.COSEALG.ES256, cose_js_1.COSEALG.PS256, cose_js_1.COSEALG.RS256].indexOf(alg) >= 0) {
        return 'SHA-256';
    }
    else if ([cose_js_1.COSEALG.ES384, cose_js_1.COSEALG.PS384, cose_js_1.COSEALG.RS384].indexOf(alg) >= 0) {
        return 'SHA-384';
    }
    else if ([cose_js_1.COSEALG.ES512, cose_js_1.COSEALG.PS512, cose_js_1.COSEALG.RS512, cose_js_1.COSEALG.EdDSA].indexOf(alg) >=
        0) {
        return 'SHA-512';
    }
    throw new Error(`Could not map COSE alg value of ${alg} to a WebCrypto alg`);
}
