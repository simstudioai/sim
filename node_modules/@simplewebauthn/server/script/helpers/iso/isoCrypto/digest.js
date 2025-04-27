"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.digest = digest;
const mapCoseAlgToWebCryptoAlg_js_1 = require("./mapCoseAlgToWebCryptoAlg.js");
const getWebCrypto_js_1 = require("./getWebCrypto.js");
/**
 * Generate a digest of the provided data.
 *
 * @param data The data to generate a digest of
 * @param algorithm A COSE algorithm ID that maps to a desired SHA algorithm
 */
async function digest(data, algorithm) {
    const WebCrypto = await (0, getWebCrypto_js_1.getWebCrypto)();
    const subtleAlgorithm = (0, mapCoseAlgToWebCryptoAlg_js_1.mapCoseAlgToWebCryptoAlg)(algorithm);
    const hashed = await WebCrypto.subtle.digest(subtleAlgorithm, data);
    return new Uint8Array(hashed);
}
