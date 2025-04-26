"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyAttestationPacked = verifyAttestationPacked;
const cose_js_1 = require("../../helpers/cose.js");
const convertCertBufferToPEM_js_1 = require("../../helpers/convertCertBufferToPEM.js");
const validateCertificatePath_js_1 = require("../../helpers/validateCertificatePath.js");
const getCertificateInfo_js_1 = require("../../helpers/getCertificateInfo.js");
const verifySignature_js_1 = require("../../helpers/verifySignature.js");
const index_js_1 = require("../../helpers/iso/index.js");
const validateExtFIDOGenCEAAGUID_js_1 = require("../../helpers/validateExtFIDOGenCEAAGUID.js");
const metadataService_js_1 = require("../../services/metadataService.js");
const verifyAttestationWithMetadata_js_1 = require("../../metadata/verifyAttestationWithMetadata.js");
/**
 * Verify an attestation response with fmt 'packed'
 */
async function verifyAttestationPacked(options) {
    const { attStmt, clientDataHash, authData, credentialPublicKey, aaguid, rootCertificates, } = options;
    const sig = attStmt.get('sig');
    const x5c = attStmt.get('x5c');
    const alg = attStmt.get('alg');
    if (!sig) {
        throw new Error('No attestation signature provided in attestation statement (Packed)');
    }
    if (!alg) {
        throw new Error('Attestation statement did not contain alg (Packed)');
    }
    if (!(0, cose_js_1.isCOSEAlg)(alg)) {
        throw new Error(`Attestation statement contained invalid alg ${alg} (Packed)`);
    }
    const signatureBase = index_js_1.isoUint8Array.concat([authData, clientDataHash]);
    let verified = false;
    if (x5c) {
        const { subject, basicConstraintsCA, version, notBefore, notAfter, parsedCertificate, } = (0, getCertificateInfo_js_1.getCertificateInfo)(x5c[0]);
        const { OU, CN, O, C } = subject;
        if (OU !== 'Authenticator Attestation') {
            throw new Error('Certificate OU was not "Authenticator Attestation" (Packed|Full)');
        }
        if (!CN) {
            throw new Error('Certificate CN was empty (Packed|Full)');
        }
        if (!O) {
            throw new Error('Certificate O was empty (Packed|Full)');
        }
        if (!C || C.length !== 2) {
            throw new Error('Certificate C was not two-character ISO 3166 code (Packed|Full)');
        }
        if (basicConstraintsCA) {
            throw new Error('Certificate basic constraints CA was not `false` (Packed|Full)');
        }
        if (version !== 2) {
            throw new Error('Certificate version was not `3` (ASN.1 value of 2) (Packed|Full)');
        }
        let now = new Date();
        if (notBefore > now) {
            throw new Error(`Certificate not good before "${notBefore.toString()}" (Packed|Full)`);
        }
        now = new Date();
        if (notAfter < now) {
            throw new Error(`Certificate not good after "${notAfter.toString()}" (Packed|Full)`);
        }
        // Validate attestation statement AAGUID against leaf cert AAGUID
        try {
            await (0, validateExtFIDOGenCEAAGUID_js_1.validateExtFIDOGenCEAAGUID)(parsedCertificate.tbsCertificate.extensions, aaguid);
        }
        catch (err) {
            const _err = err;
            throw new Error(`${_err.message} (Packed|Full)`);
        }
        // If available, validate attestation alg and x5c with info in the metadata statement
        const statement = await metadataService_js_1.MetadataService.getStatement(aaguid);
        if (statement) {
            // The presence of x5c means this is a full attestation. Check to see if attestationTypes
            // includes packed attestations.
            if (statement.attestationTypes.indexOf('basic_full') < 0) {
                throw new Error('Metadata does not indicate support for full attestations (Packed|Full)');
            }
            try {
                await (0, verifyAttestationWithMetadata_js_1.verifyAttestationWithMetadata)({
                    statement,
                    credentialPublicKey,
                    x5c,
                    attestationStatementAlg: alg,
                });
            }
            catch (err) {
                const _err = err;
                throw new Error(`${_err.message} (Packed|Full)`);
            }
        }
        else {
            try {
                // Try validating the certificate path using the root certificates set via SettingsService
                await (0, validateCertificatePath_js_1.validateCertificatePath)(x5c.map(convertCertBufferToPEM_js_1.convertCertBufferToPEM), rootCertificates);
            }
            catch (err) {
                const _err = err;
                throw new Error(`${_err.message} (Packed|Full)`);
            }
        }
        verified = await (0, verifySignature_js_1.verifySignature)({
            signature: sig,
            data: signatureBase,
            x509Certificate: x5c[0],
        });
    }
    else {
        verified = await (0, verifySignature_js_1.verifySignature)({
            signature: sig,
            data: signatureBase,
            credentialPublicKey,
            hashAlgorithm: alg,
        });
    }
    return verified;
}
