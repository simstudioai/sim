"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRandomValues = getRandomValues;
const getWebCrypto_js_1 = require("./getWebCrypto.js");
/**
 * Fill up the provided bytes array with random bytes equal to its length.
 *
 * @returns the same bytes array passed into the method
 */
async function getRandomValues(array) {
    const WebCrypto = await (0, getWebCrypto_js_1.getWebCrypto)();
    WebCrypto.getRandomValues(array);
    return array;
}
