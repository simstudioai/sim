"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeAuthenticatorExtensions = decodeAuthenticatorExtensions;
const index_js_1 = require("./iso/index.js");
/**
 * Convert authenticator extension data buffer to a proper object
 *
 * @param extensionData Authenticator Extension Data buffer
 */
function decodeAuthenticatorExtensions(extensionData) {
    let toCBOR;
    try {
        toCBOR = index_js_1.isoCBOR.decodeFirst(extensionData);
    }
    catch (err) {
        const _err = err;
        throw new Error(`Error decoding authenticator extensions: ${_err.message}`);
    }
    return convertMapToObjectDeep(toCBOR);
}
/**
 * CBOR-encoded extensions can be deeply-nested Maps, which are too deep for a simple
 * `Object.entries()`. This method will recursively make sure that all Maps are converted into
 * basic objects.
 */
function convertMapToObjectDeep(input) {
    const mapped = {};
    for (const [key, value] of input) {
        if (value instanceof Map) {
            mapped[key] = convertMapToObjectDeep(value);
        }
        else {
            mapped[key] = value;
        }
    }
    return mapped;
}
