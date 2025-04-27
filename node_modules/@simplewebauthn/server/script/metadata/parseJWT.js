"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseJWT = parseJWT;
const index_js_1 = require("../helpers/iso/index.js");
/**
 * Process a JWT into Javascript-friendly data structures
 */
function parseJWT(jwt) {
    const parts = jwt.split('.');
    return [
        JSON.parse(index_js_1.isoBase64URL.toUTF8String(parts[0])),
        JSON.parse(index_js_1.isoBase64URL.toUTF8String(parts[1])),
        parts[2],
    ];
}
