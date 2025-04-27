"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports._verifySignatureInternals = void 0;
exports.verifySignature = verifySignature;
const index_js_1 = require("./iso/index.js");
const decodeCredentialPublicKey_js_1 = require("./decodeCredentialPublicKey.js");
const convertX509PublicKeyToCOSE_js_1 = require("./convertX509PublicKeyToCOSE.js");
/**
 * Verify an authenticator's signature
 */
function verifySignature(opts) {
    const { signature, data, credentialPublicKey, x509Certificate, hashAlgorithm, } = opts;
    if (!x509Certificate && !credentialPublicKey) {
        throw new Error('Must declare either "leafCert" or "credentialPublicKey"');
    }
    if (x509Certificate && credentialPublicKey) {
        throw new Error('Must not declare both "leafCert" and "credentialPublicKey"');
    }
    let cosePublicKey = new Map();
    if (credentialPublicKey) {
        cosePublicKey = (0, decodeCredentialPublicKey_js_1.decodeCredentialPublicKey)(credentialPublicKey);
    }
    else if (x509Certificate) {
        cosePublicKey = (0, convertX509PublicKeyToCOSE_js_1.convertX509PublicKeyToCOSE)(x509Certificate);
    }
    return exports._verifySignatureInternals.stubThis(index_js_1.isoCrypto.verify({
        cosePublicKey,
        signature,
        data,
        shaHashOverride: hashAlgorithm,
    }));
}
/**
 * Make it possible to stub the return value during testing
 * @ignore Don't include this in docs output
 */
exports._verifySignatureInternals = {
    stubThis: (value) => value,
};
