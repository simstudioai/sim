"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertCertBufferToPEM = convertCertBufferToPEM;
const index_js_1 = require("./iso/index.js");
/**
 * Convert buffer to an OpenSSL-compatible PEM text format.
 */
function convertCertBufferToPEM(certBuffer) {
    let b64cert;
    /**
     * Get certBuffer to a base64 representation
     */
    if (typeof certBuffer === 'string') {
        if (index_js_1.isoBase64URL.isBase64URL(certBuffer)) {
            b64cert = index_js_1.isoBase64URL.toBase64(certBuffer);
        }
        else if (index_js_1.isoBase64URL.isBase64(certBuffer)) {
            b64cert = certBuffer;
        }
        else {
            throw new Error('Certificate is not a valid base64 or base64url string');
        }
    }
    else {
        b64cert = index_js_1.isoBase64URL.fromBuffer(certBuffer, 'base64');
    }
    let PEMKey = '';
    for (let i = 0; i < Math.ceil(b64cert.length / 64); i += 1) {
        const start = 64 * i;
        PEMKey += `${b64cert.substr(start, 64)}\n`;
    }
    PEMKey = `-----BEGIN CERTIFICATE-----\n${PEMKey}-----END CERTIFICATE-----\n`;
    return PEMKey;
}
