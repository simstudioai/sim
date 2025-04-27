"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports._decodeAttestationObjectInternals = void 0;
exports.decodeAttestationObject = decodeAttestationObject;
const index_js_1 = require("./iso/index.js");
/**
 * Convert an AttestationObject buffer to a proper object
 *
 * @param base64AttestationObject Attestation Object buffer
 */
function decodeAttestationObject(attestationObject) {
    return exports._decodeAttestationObjectInternals.stubThis(index_js_1.isoCBOR.decodeFirst(attestationObject));
}
/**
 * Make it possible to stub the return value during testing
 * @ignore Don't include this in docs output
 */
exports._decodeAttestationObjectInternals = {
    stubThis: (value) => value,
};
