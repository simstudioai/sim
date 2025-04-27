"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toHash = toHash;
const index_js_1 = require("./iso/index.js");
/**
 * Returns hash digest of the given data, using the given algorithm when provided. Defaults to using
 * SHA-256.
 */
function toHash(data, algorithm = -7) {
    if (typeof data === 'string') {
        data = index_js_1.isoUint8Array.fromUTF8String(data);
    }
    const digest = index_js_1.isoCrypto.digest(data, algorithm);
    return digest;
}
