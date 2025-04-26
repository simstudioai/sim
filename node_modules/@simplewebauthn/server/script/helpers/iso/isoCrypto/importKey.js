"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.importKey = importKey;
const getWebCrypto_js_1 = require("./getWebCrypto.js");
async function importKey(opts) {
    const WebCrypto = await (0, getWebCrypto_js_1.getWebCrypto)();
    const { keyData, algorithm } = opts;
    return WebCrypto.subtle.importKey('jwk', keyData, algorithm, false, [
        'verify',
    ]);
}
