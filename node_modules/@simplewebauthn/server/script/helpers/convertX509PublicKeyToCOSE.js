"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertX509PublicKeyToCOSE = convertX509PublicKeyToCOSE;
const asn1_schema_1 = require("@peculiar/asn1-schema");
const asn1_x509_1 = require("@peculiar/asn1-x509");
const asn1_ecc_1 = require("@peculiar/asn1-ecc");
const cose_js_1 = require("./cose.js");
const asn1_rsa_1 = require("@peculiar/asn1-rsa");
const mapX509SignatureAlgToCOSEAlg_js_1 = require("./mapX509SignatureAlgToCOSEAlg.js");
function convertX509PublicKeyToCOSE(x509Certificate) {
    let cosePublicKey = new Map();
    /**
     * Time to extract the public key from an X.509 certificate
     */
    const x509 = asn1_schema_1.AsnParser.parse(x509Certificate, asn1_x509_1.Certificate);
    const { tbsCertificate } = x509;
    const { subjectPublicKeyInfo, signature: _tbsSignature } = tbsCertificate;
    const signatureAlgorithm = _tbsSignature.algorithm;
    const publicKeyAlgorithmID = subjectPublicKeyInfo.algorithm.algorithm;
    if (publicKeyAlgorithmID === asn1_ecc_1.id_ecPublicKey) {
        /**
         * EC2 Public Key
         */
        if (!subjectPublicKeyInfo.algorithm.parameters) {
            throw new Error('Certificate public key was missing parameters (EC2)');
        }
        const ecParameters = asn1_schema_1.AsnParser.parse(new Uint8Array(subjectPublicKeyInfo.algorithm.parameters), asn1_ecc_1.ECParameters);
        let crv = -999;
        const { namedCurve } = ecParameters;
        if (namedCurve === asn1_ecc_1.id_secp256r1) {
            crv = cose_js_1.COSECRV.P256;
        }
        else if (namedCurve === asn1_ecc_1.id_secp384r1) {
            crv = cose_js_1.COSECRV.P384;
        }
        else {
            throw new Error(`Certificate public key contained unexpected namedCurve ${namedCurve} (EC2)`);
        }
        const subjectPublicKey = new Uint8Array(subjectPublicKeyInfo.subjectPublicKey);
        let x;
        let y;
        if (subjectPublicKey[0] === 0x04) {
            // Public key is in "uncompressed form", so we can split the remaining bytes in half
            let pointer = 1;
            const halfLength = (subjectPublicKey.length - 1) / 2;
            x = subjectPublicKey.slice(pointer, pointer += halfLength);
            y = subjectPublicKey.slice(pointer);
        }
        else {
            throw new Error('TODO: Figure out how to handle public keys in "compressed form"');
        }
        const coseEC2PubKey = new Map();
        coseEC2PubKey.set(cose_js_1.COSEKEYS.kty, cose_js_1.COSEKTY.EC2);
        coseEC2PubKey.set(cose_js_1.COSEKEYS.alg, (0, mapX509SignatureAlgToCOSEAlg_js_1.mapX509SignatureAlgToCOSEAlg)(signatureAlgorithm));
        coseEC2PubKey.set(cose_js_1.COSEKEYS.crv, crv);
        coseEC2PubKey.set(cose_js_1.COSEKEYS.x, x);
        coseEC2PubKey.set(cose_js_1.COSEKEYS.y, y);
        cosePublicKey = coseEC2PubKey;
    }
    else if (publicKeyAlgorithmID === '1.2.840.113549.1.1.1') {
        /**
         * RSA public key
         */
        const rsaPublicKey = asn1_schema_1.AsnParser.parse(subjectPublicKeyInfo.subjectPublicKey, asn1_rsa_1.RSAPublicKey);
        const coseRSAPubKey = new Map();
        coseRSAPubKey.set(cose_js_1.COSEKEYS.kty, cose_js_1.COSEKTY.RSA);
        coseRSAPubKey.set(cose_js_1.COSEKEYS.alg, (0, mapX509SignatureAlgToCOSEAlg_js_1.mapX509SignatureAlgToCOSEAlg)(signatureAlgorithm));
        coseRSAPubKey.set(cose_js_1.COSEKEYS.n, new Uint8Array(rsaPublicKey.modulus));
        coseRSAPubKey.set(cose_js_1.COSEKEYS.e, new Uint8Array(rsaPublicKey.publicExponent));
        cosePublicKey = coseRSAPubKey;
    }
    else {
        throw new Error(`Certificate public key contained unexpected algorithm ID ${publicKeyAlgorithmID}`);
    }
    return cosePublicKey;
}
