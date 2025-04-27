"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports._decodeCredentialPublicKeyInternals = void 0;
exports.decodeCredentialPublicKey = decodeCredentialPublicKey;
const index_js_1 = require("./iso/index.js");
function decodeCredentialPublicKey(publicKey) {
    return exports._decodeCredentialPublicKeyInternals.stubThis(index_js_1.isoCBOR.decodeFirst(publicKey));
}
/**
 * Make it possible to stub the return value during testing
 * @ignore Don't include this in docs output
 */
exports._decodeCredentialPublicKeyInternals = {
    stubThis: (value) => value,
};
