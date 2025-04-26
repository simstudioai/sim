"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertAAGUIDToString = convertAAGUIDToString;
const index_js_1 = require("./iso/index.js");
/**
 * Convert the aaguid buffer in authData into a UUID string
 */
function convertAAGUIDToString(aaguid) {
    // Raw Hex: adce000235bcc60a648b0b25f1f05503
    const hex = index_js_1.isoUint8Array.toHex(aaguid);
    const segments = [
        hex.slice(0, 8), // 8
        hex.slice(8, 12), // 4
        hex.slice(12, 16), // 4
        hex.slice(16, 20), // 4
        hex.slice(20, 32), // 8
    ];
    // Formatted: adce0002-35bc-c60a-648b-0b25f1f05503
    return segments.join('-');
}
