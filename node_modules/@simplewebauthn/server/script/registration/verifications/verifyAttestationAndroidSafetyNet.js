"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyAttestationAndroidSafetyNet = verifyAttestationAndroidSafetyNet;
const toHash_js_1 = require("../../helpers/toHash.js");
const verifySignature_js_1 = require("../../helpers/verifySignature.js");
const getCertificateInfo_js_1 = require("../../helpers/getCertificateInfo.js");
const validateCertificatePath_js_1 = require("../../helpers/validateCertificatePath.js");
const convertCertBufferToPEM_js_1 = require("../../helpers/convertCertBufferToPEM.js");
const index_js_1 = require("../../helpers/iso/index.js");
const metadataService_js_1 = require("../../services/metadataService.js");
const verifyAttestationWithMetadata_js_1 = require("../../metadata/verifyAttestationWithMetadata.js");
/**
 * Verify an attestation response with fmt 'android-safetynet'
 */
async function verifyAttestationAndroidSafetyNet(options) {
    const { attStmt, clientDataHash, authData, aaguid, rootCertificates, verifyTimestampMS = true, credentialPublicKey, } = options;
    const alg = attStmt.get('alg');
    const response = attStmt.get('response');
    const ver = attStmt.get('ver');
    if (!ver) {
        throw new Error('No ver value in attestation (SafetyNet)');
    }
    if (!response) {
        throw new Error('No response was included in attStmt by authenticator (SafetyNet)');
    }
    // Prepare to verify a JWT
    const jwt = index_js_1.isoUint8Array.toUTF8String(response);
    const jwtParts = jwt.split('.');
    const HEADER = JSON.parse(index_js_1.isoBase64URL.toUTF8String(jwtParts[0]));
    const PAYLOAD = JSON.parse(index_js_1.isoBase64URL.toUTF8String(jwtParts[1]));
    const SIGNATURE = jwtParts[2];
    /**
     * START Verify PAYLOAD
     */
    const { nonce, ctsProfileMatch, timestampMs } = PAYLOAD;
    if (verifyTimestampMS) {
        // Make sure timestamp is in the past
        let now = Date.now();
        if (timestampMs > Date.now()) {
            throw new Error(`Payload timestamp "${timestampMs}" was later than "${now}" (SafetyNet)`);
        }
        // Consider a SafetyNet attestation valid within a minute of it being performed
        const timestampPlusDelay = timestampMs + 60 * 1000;
        now = Date.now();
        if (timestampPlusDelay < now) {
            throw new Error(`Payload timestamp "${timestampPlusDelay}" has expired (SafetyNet)`);
        }
    }
    const nonceBase = index_js_1.isoUint8Array.concat([authData, clientDataHash]);
    const nonceBuffer = await (0, toHash_js_1.toHash)(nonceBase);
    const expectedNonce = index_js_1.isoBase64URL.fromBuffer(nonceBuffer, 'base64');
    if (nonce !== expectedNonce) {
        throw new Error('Could not verify payload nonce (SafetyNet)');
    }
    if (!ctsProfileMatch) {
        throw new Error('Could not verify device integrity (SafetyNet)');
    }
    /**
     * END Verify PAYLOAD
     */
    /**
     * START Verify Header
     */
    // `HEADER.x5c[0]` is definitely a base64 string
    const leafCertBuffer = index_js_1.isoBase64URL.toBuffer(HEADER.x5c[0], 'base64');
    const leafCertInfo = (0, getCertificateInfo_js_1.getCertificateInfo)(leafCertBuffer);
    const { subject } = leafCertInfo;
    // Ensure the certificate was issued to this hostname
    // See https://developer.android.com/training/safetynet/attestation#verify-attestation-response
    if (subject.CN !== 'attest.android.com') {
        throw new Error('Certificate common name was not "attest.android.com" (SafetyNet)');
    }
    const statement = await metadataService_js_1.MetadataService.getStatement(aaguid);
    if (statement) {
        try {
            await (0, verifyAttestationWithMetadata_js_1.verifyAttestationWithMetadata)({
                statement,
                credentialPublicKey,
                x5c: HEADER.x5c,
                attestationStatementAlg: alg,
            });
        }
        catch (err) {
            const _err = err;
            throw new Error(`${_err.message} (SafetyNet)`);
        }
    }
    else {
        try {
            // Try validating the certificate path using the root certificates set via SettingsService
            await (0, validateCertificatePath_js_1.validateCertificatePath)(HEADER.x5c.map(convertCertBufferToPEM_js_1.convertCertBufferToPEM), rootCertificates);
        }
        catch (err) {
            const _err = err;
            throw new Error(`${_err.message} (SafetyNet)`);
        }
    }
    /**
     * END Verify Header
     */
    /**
     * START Verify Signature
     */
    const signatureBaseBuffer = index_js_1.isoUint8Array.fromUTF8String(`${jwtParts[0]}.${jwtParts[1]}`);
    const signatureBuffer = index_js_1.isoBase64URL.toBuffer(SIGNATURE);
    const verified = await (0, verifySignature_js_1.verifySignature)({
        signature: signatureBuffer,
        data: signatureBaseBuffer,
        x509Certificate: leafCertBuffer,
    });
    /**
     * END Verify Signature
     */
    return verified;
}
