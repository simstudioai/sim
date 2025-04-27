"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertPEMToBytes = convertPEMToBytes;
const index_js_1 = require("./iso/index.js");
/**
 * Take a certificate in PEM format and convert it to bytes
 */
function convertPEMToBytes(pem) {
    const certBase64 = pem
        .replace('-----BEGIN CERTIFICATE-----', '')
        .replace('-----END CERTIFICATE-----', '')
        .replace(/[\n ]/g, '');
    return index_js_1.isoBase64URL.toBuffer(certBase64, 'base64');
}
