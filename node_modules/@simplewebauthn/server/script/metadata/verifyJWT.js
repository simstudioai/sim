"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyJWT = verifyJWT;
const convertX509PublicKeyToCOSE_js_1 = require("../helpers/convertX509PublicKeyToCOSE.js");
const index_js_1 = require("../helpers/iso/index.js");
const cose_js_1 = require("../helpers/cose.js");
const verifyEC2_js_1 = require("../helpers/iso/isoCrypto/verifyEC2.js");
const verifyRSA_js_1 = require("../helpers/iso/isoCrypto/verifyRSA.js");
/**
 * Lightweight verification for FIDO MDS JWTs. Supports use of EC2 and RSA.
 *
 * If this ever needs to support more JWS algorithms, here's the list of them:
 *
 * https://www.rfc-editor.org/rfc/rfc7518.html#section-3.1
 *
 * (Pulled from https://www.rfc-editor.org/rfc/rfc7515#section-4.1.1)
 */
function verifyJWT(jwt, leafCert) {
    const [header, payload, signature] = jwt.split('.');
    const certCOSE = (0, convertX509PublicKeyToCOSE_js_1.convertX509PublicKeyToCOSE)(leafCert);
    const data = index_js_1.isoUint8Array.fromUTF8String(`${header}.${payload}`);
    const signatureBytes = index_js_1.isoBase64URL.toBuffer(signature);
    if ((0, cose_js_1.isCOSEPublicKeyEC2)(certCOSE)) {
        return (0, verifyEC2_js_1.verifyEC2)({
            data,
            signature: signatureBytes,
            cosePublicKey: certCOSE,
            shaHashOverride: cose_js_1.COSEALG.ES256,
        });
    }
    else if ((0, cose_js_1.isCOSEPublicKeyRSA)(certCOSE)) {
        return (0, verifyRSA_js_1.verifyRSA)({
            data,
            signature: signatureBytes,
            cosePublicKey: certCOSE,
        });
    }
    const kty = certCOSE.get(cose_js_1.COSEKEYS.kty);
    throw new Error(`JWT verification with public key of kty ${kty} is not supported by this method`);
}
