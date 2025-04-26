"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyAttestationApple = verifyAttestationApple;
const asn1_schema_1 = require("@peculiar/asn1-schema");
const asn1_x509_1 = require("@peculiar/asn1-x509");
const validateCertificatePath_js_1 = require("../../helpers/validateCertificatePath.js");
const convertCertBufferToPEM_js_1 = require("../../helpers/convertCertBufferToPEM.js");
const toHash_js_1 = require("../../helpers/toHash.js");
const convertCOSEtoPKCS_js_1 = require("../../helpers/convertCOSEtoPKCS.js");
const index_js_1 = require("../../helpers/iso/index.js");
async function verifyAttestationApple(options) {
    const { attStmt, authData, clientDataHash, credentialPublicKey, rootCertificates, } = options;
    const x5c = attStmt.get('x5c');
    if (!x5c) {
        throw new Error('No attestation certificate provided in attestation statement (Apple)');
    }
    /**
     * Verify certificate path
     */
    try {
        await (0, validateCertificatePath_js_1.validateCertificatePath)(x5c.map(convertCertBufferToPEM_js_1.convertCertBufferToPEM), rootCertificates);
    }
    catch (err) {
        const _err = err;
        throw new Error(`${_err.message} (Apple)`);
    }
    /**
     * Compare nonce in certificate extension to computed nonce
     */
    const parsedCredCert = asn1_schema_1.AsnParser.parse(x5c[0], asn1_x509_1.Certificate);
    const { extensions, subjectPublicKeyInfo } = parsedCredCert.tbsCertificate;
    if (!extensions) {
        throw new Error('credCert missing extensions (Apple)');
    }
    const extCertNonce = extensions.find((ext) => ext.extnID === '1.2.840.113635.100.8.2');
    if (!extCertNonce) {
        throw new Error('credCert missing "1.2.840.113635.100.8.2" extension (Apple)');
    }
    const nonceToHash = index_js_1.isoUint8Array.concat([authData, clientDataHash]);
    const nonce = await (0, toHash_js_1.toHash)(nonceToHash);
    /**
     * Ignore the first six ASN.1 structure bytes that define the nonce as an OCTET STRING. Should
     * trim off <Buffer 30 24 a1 22 04 20>
     *
     * TODO: Try and get @peculiar (GitHub) to add a schema for "1.2.840.113635.100.8.2" when we
     * find out where it's defined (doesn't seem to be publicly documented at the moment...)
     */
    const extNonce = new Uint8Array(extCertNonce.extnValue.buffer).slice(6);
    if (!index_js_1.isoUint8Array.areEqual(nonce, extNonce)) {
        throw new Error(`credCert nonce was not expected value (Apple)`);
    }
    /**
     * Verify credential public key matches the Subject Public Key of credCert
     */
    const credPubKeyPKCS = (0, convertCOSEtoPKCS_js_1.convertCOSEtoPKCS)(credentialPublicKey);
    const credCertSubjectPublicKey = new Uint8Array(subjectPublicKeyInfo.subjectPublicKey);
    if (!index_js_1.isoUint8Array.areEqual(credPubKeyPKCS, credCertSubjectPublicKey)) {
        throw new Error('Credential public key does not equal credCert public key (Apple)');
    }
    return true;
}
