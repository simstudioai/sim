"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports._decodeClientDataJSONInternals = void 0;
exports.decodeClientDataJSON = decodeClientDataJSON;
const index_js_1 = require("./iso/index.js");
/**
 * Decode an authenticator's base64url-encoded clientDataJSON to JSON
 */
function decodeClientDataJSON(data) {
    const toString = index_js_1.isoBase64URL.toUTF8String(data);
    const clientData = JSON.parse(toString);
    return exports._decodeClientDataJSONInternals.stubThis(clientData);
}
/**
 * Make it possible to stub the return value during testing
 * @ignore Don't include this in docs output
 */
exports._decodeClientDataJSONInternals = {
    stubThis: (value) => value,
};
