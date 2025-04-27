"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verify = verify;
const cose_js_1 = require("../../cose.js");
const verifyEC2_js_1 = require("./verifyEC2.js");
const verifyRSA_js_1 = require("./verifyRSA.js");
const verifyOKP_js_1 = require("./verifyOKP.js");
const unwrapEC2Signature_js_1 = require("./unwrapEC2Signature.js");
/**
 * Verify signatures with their public key. Supports EC2 and RSA public keys.
 */
function verify(opts) {
    const { cosePublicKey, signature, data, shaHashOverride } = opts;
    if ((0, cose_js_1.isCOSEPublicKeyEC2)(cosePublicKey)) {
        const crv = cosePublicKey.get(cose_js_1.COSEKEYS.crv);
        if (!(0, cose_js_1.isCOSECrv)(crv)) {
            throw new Error(`unknown COSE curve ${crv}`);
        }
        const unwrappedSignature = (0, unwrapEC2Signature_js_1.unwrapEC2Signature)(signature, crv);
        return (0, verifyEC2_js_1.verifyEC2)({
            cosePublicKey,
            signature: unwrappedSignature,
            data,
            shaHashOverride,
        });
    }
    else if ((0, cose_js_1.isCOSEPublicKeyRSA)(cosePublicKey)) {
        return (0, verifyRSA_js_1.verifyRSA)({ cosePublicKey, signature, data, shaHashOverride });
    }
    else if ((0, cose_js_1.isCOSEPublicKeyOKP)(cosePublicKey)) {
        return (0, verifyOKP_js_1.verifyOKP)({ cosePublicKey, signature, data });
    }
    const kty = cosePublicKey.get(cose_js_1.COSEKEYS.kty);
    throw new Error(`Signature verification with public key of kty ${kty} is not supported by this method`);
}
