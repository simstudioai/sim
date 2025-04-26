"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyRSA = verifyRSA;
const cose_js_1 = require("../../cose.js");
const mapCoseAlgToWebCryptoAlg_js_1 = require("./mapCoseAlgToWebCryptoAlg.js");
const importKey_js_1 = require("./importKey.js");
const index_js_1 = require("../index.js");
const mapCoseAlgToWebCryptoKeyAlgName_js_1 = require("./mapCoseAlgToWebCryptoKeyAlgName.js");
const getWebCrypto_js_1 = require("./getWebCrypto.js");
/**
 * Verify a signature using an RSA public key
 */
async function verifyRSA(opts) {
    const { cosePublicKey, signature, data, shaHashOverride } = opts;
    const WebCrypto = await (0, getWebCrypto_js_1.getWebCrypto)();
    const alg = cosePublicKey.get(cose_js_1.COSEKEYS.alg);
    const n = cosePublicKey.get(cose_js_1.COSEKEYS.n);
    const e = cosePublicKey.get(cose_js_1.COSEKEYS.e);
    if (!alg) {
        throw new Error('Public key was missing alg (RSA)');
    }
    if (!(0, cose_js_1.isCOSEAlg)(alg)) {
        throw new Error(`Public key had invalid alg ${alg} (RSA)`);
    }
    if (!n) {
        throw new Error('Public key was missing n (RSA)');
    }
    if (!e) {
        throw new Error('Public key was missing e (RSA)');
    }
    const keyData = {
        kty: 'RSA',
        alg: '',
        n: index_js_1.isoBase64URL.fromBuffer(n),
        e: index_js_1.isoBase64URL.fromBuffer(e),
        ext: false,
    };
    const keyAlgorithm = {
        name: (0, mapCoseAlgToWebCryptoKeyAlgName_js_1.mapCoseAlgToWebCryptoKeyAlgName)(alg),
        hash: { name: (0, mapCoseAlgToWebCryptoAlg_js_1.mapCoseAlgToWebCryptoAlg)(alg) },
    };
    const verifyAlgorithm = {
        name: (0, mapCoseAlgToWebCryptoKeyAlgName_js_1.mapCoseAlgToWebCryptoKeyAlgName)(alg),
    };
    if (shaHashOverride) {
        keyAlgorithm.hash.name = (0, mapCoseAlgToWebCryptoAlg_js_1.mapCoseAlgToWebCryptoAlg)(shaHashOverride);
    }
    if (keyAlgorithm.name === 'RSASSA-PKCS1-v1_5') {
        if (keyAlgorithm.hash.name === 'SHA-256') {
            keyData.alg = 'RS256';
        }
        else if (keyAlgorithm.hash.name === 'SHA-384') {
            keyData.alg = 'RS384';
        }
        else if (keyAlgorithm.hash.name === 'SHA-512') {
            keyData.alg = 'RS512';
        }
        else if (keyAlgorithm.hash.name === 'SHA-1') {
            keyData.alg = 'RS1';
        }
    }
    else if (keyAlgorithm.name === 'RSA-PSS') {
        /**
         * salt length. The default value is 20 but the convention is to use hLen, the length of the
         * output of the hash function in bytes. A salt length of zero is permitted and will result in
         * a deterministic signature value. The actual salt length used can be determined from the
         * signature value.
         *
         * From https://www.cryptosys.net/pki/manpki/pki_rsaschemes.html
         */
        let saltLength = 0;
        if (keyAlgorithm.hash.name === 'SHA-256') {
            keyData.alg = 'PS256';
            saltLength = 32; // 256 bits => 32 bytes
        }
        else if (keyAlgorithm.hash.name === 'SHA-384') {
            keyData.alg = 'PS384';
            saltLength = 48; // 384 bits => 48 bytes
        }
        else if (keyAlgorithm.hash.name === 'SHA-512') {
            keyData.alg = 'PS512';
            saltLength = 64; // 512 bits => 64 bytes
        }
        verifyAlgorithm.saltLength = saltLength;
    }
    else {
        throw new Error(`Unexpected RSA key algorithm ${alg} (${keyAlgorithm.name})`);
    }
    const key = await (0, importKey_js_1.importKey)({
        keyData,
        algorithm: keyAlgorithm,
    });
    return WebCrypto.subtle.verify(verifyAlgorithm, key, signature, data);
}
