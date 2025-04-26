"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyEC2 = verifyEC2;
const cose_js_1 = require("../../cose.js");
const mapCoseAlgToWebCryptoAlg_js_1 = require("./mapCoseAlgToWebCryptoAlg.js");
const importKey_js_1 = require("./importKey.js");
const index_js_1 = require("../index.js");
const getWebCrypto_js_1 = require("./getWebCrypto.js");
/**
 * Verify a signature using an EC2 public key
 */
async function verifyEC2(opts) {
    const { cosePublicKey, signature, data, shaHashOverride } = opts;
    const WebCrypto = await (0, getWebCrypto_js_1.getWebCrypto)();
    // Import the public key
    const alg = cosePublicKey.get(cose_js_1.COSEKEYS.alg);
    const crv = cosePublicKey.get(cose_js_1.COSEKEYS.crv);
    const x = cosePublicKey.get(cose_js_1.COSEKEYS.x);
    const y = cosePublicKey.get(cose_js_1.COSEKEYS.y);
    if (!alg) {
        throw new Error('Public key was missing alg (EC2)');
    }
    if (!crv) {
        throw new Error('Public key was missing crv (EC2)');
    }
    if (!x) {
        throw new Error('Public key was missing x (EC2)');
    }
    if (!y) {
        throw new Error('Public key was missing y (EC2)');
    }
    let _crv;
    if (crv === cose_js_1.COSECRV.P256) {
        _crv = 'P-256';
    }
    else if (crv === cose_js_1.COSECRV.P384) {
        _crv = 'P-384';
    }
    else if (crv === cose_js_1.COSECRV.P521) {
        _crv = 'P-521';
    }
    else {
        throw new Error(`Unexpected COSE crv value of ${crv} (EC2)`);
    }
    const keyData = {
        kty: 'EC',
        crv: _crv,
        x: index_js_1.isoBase64URL.fromBuffer(x),
        y: index_js_1.isoBase64URL.fromBuffer(y),
        ext: false,
    };
    const keyAlgorithm = {
        /**
         * Note to future self: you can't use `mapCoseAlgToWebCryptoKeyAlgName()` here because some
         * leaf certs from actual devices specified an RSA SHA value for `alg` (e.g. `-257`) which
         * would then map here to `'RSASSA-PKCS1-v1_5'`. We always want `'ECDSA'` here so we'll
         * hard-code this.
         */
        name: 'ECDSA',
        namedCurve: _crv,
    };
    const key = await (0, importKey_js_1.importKey)({
        keyData,
        algorithm: keyAlgorithm,
    });
    // Determine which SHA algorithm to use for signature verification
    let subtleAlg = (0, mapCoseAlgToWebCryptoAlg_js_1.mapCoseAlgToWebCryptoAlg)(alg);
    if (shaHashOverride) {
        subtleAlg = (0, mapCoseAlgToWebCryptoAlg_js_1.mapCoseAlgToWebCryptoAlg)(shaHashOverride);
    }
    const verifyAlgorithm = {
        name: 'ECDSA',
        hash: { name: subtleAlg },
    };
    return WebCrypto.subtle.verify(verifyAlgorithm, key, signature, data);
}
