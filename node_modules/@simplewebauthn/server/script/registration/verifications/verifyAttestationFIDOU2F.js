"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyAttestationFIDOU2F = verifyAttestationFIDOU2F;
const convertCOSEtoPKCS_js_1 = require("../../helpers/convertCOSEtoPKCS.js");
const convertCertBufferToPEM_js_1 = require("../../helpers/convertCertBufferToPEM.js");
const validateCertificatePath_js_1 = require("../../helpers/validateCertificatePath.js");
const verifySignature_js_1 = require("../../helpers/verifySignature.js");
const index_js_1 = require("../../helpers/iso/index.js");
const cose_js_1 = require("../../helpers/cose.js");
/**
 * Verify an attestation response with fmt 'fido-u2f'
 */
async function verifyAttestationFIDOU2F(options) {
    const { attStmt, clientDataHash, rpIdHash, credentialID, credentialPublicKey, aaguid, rootCertificates, } = options;
    const reservedByte = Uint8Array.from([0x00]);
    const publicKey = (0, convertCOSEtoPKCS_js_1.convertCOSEtoPKCS)(credentialPublicKey);
    const signatureBase = index_js_1.isoUint8Array.concat([
        reservedByte,
        rpIdHash,
        clientDataHash,
        credentialID,
        publicKey,
    ]);
    const sig = attStmt.get('sig');
    const x5c = attStmt.get('x5c');
    if (!x5c) {
        throw new Error('No attestation certificate provided in attestation statement (FIDOU2F)');
    }
    if (!sig) {
        throw new Error('No attestation signature provided in attestation statement (FIDOU2F)');
    }
    // FIDO spec says that aaguid _must_ equal 0x00 here to be legit
    const aaguidToHex = Number.parseInt(index_js_1.isoUint8Array.toHex(aaguid), 16);
    if (aaguidToHex !== 0x00) {
        throw new Error(`AAGUID "${aaguidToHex}" was not expected value`);
    }
    try {
        // Try validating the certificate path using the root certificates set via SettingsService
        await (0, validateCertificatePath_js_1.validateCertificatePath)(x5c.map(convertCertBufferToPEM_js_1.convertCertBufferToPEM), rootCertificates);
    }
    catch (err) {
        const _err = err;
        throw new Error(`${_err.message} (FIDOU2F)`);
    }
    return (0, verifySignature_js_1.verifySignature)({
        signature: sig,
        data: signatureBase,
        x509Certificate: x5c[0],
        hashAlgorithm: cose_js_1.COSEALG.ES256,
    });
}
