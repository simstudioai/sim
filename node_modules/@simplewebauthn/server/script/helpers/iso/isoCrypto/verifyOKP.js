"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyOKP = verifyOKP;
const cose_js_1 = require("../../cose.js");
const index_js_1 = require("../../index.js");
const importKey_js_1 = require("./importKey.js");
const getWebCrypto_js_1 = require("./getWebCrypto.js");
async function verifyOKP(opts) {
    const { cosePublicKey, signature, data } = opts;
    const WebCrypto = await (0, getWebCrypto_js_1.getWebCrypto)();
    const alg = cosePublicKey.get(cose_js_1.COSEKEYS.alg);
    const crv = cosePublicKey.get(cose_js_1.COSEKEYS.crv);
    const x = cosePublicKey.get(cose_js_1.COSEKEYS.x);
    if (!alg) {
        throw new Error('Public key was missing alg (OKP)');
    }
    if (!(0, cose_js_1.isCOSEAlg)(alg)) {
        throw new Error(`Public key had invalid alg ${alg} (OKP)`);
    }
    if (!crv) {
        throw new Error('Public key was missing crv (OKP)');
    }
    if (!x) {
        throw new Error('Public key was missing x (OKP)');
    }
    // Pulled key import steps from here:
    // https://wicg.github.io/webcrypto-secure-curves/#ed25519-operations
    let _crv;
    if (crv === cose_js_1.COSECRV.ED25519) {
        _crv = 'Ed25519';
    }
    else {
        throw new Error(`Unexpected COSE crv value of ${crv} (OKP)`);
    }
    const keyData = {
        kty: 'OKP',
        crv: _crv,
        alg: 'EdDSA',
        x: index_js_1.isoBase64URL.fromBuffer(x),
        ext: false,
    };
    const keyAlgorithm = {
        name: _crv,
        namedCurve: _crv,
    };
    const key = await (0, importKey_js_1.importKey)({
        keyData,
        algorithm: keyAlgorithm,
    });
    const verifyAlgorithm = {
        name: _crv,
    };
    return WebCrypto.subtle.verify(verifyAlgorithm, key, signature, data);
}
