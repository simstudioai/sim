"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.algSignToCOSEInfoMap = void 0;
exports.verifyAttestationWithMetadata = verifyAttestationWithMetadata;
const convertCertBufferToPEM_js_1 = require("../helpers/convertCertBufferToPEM.js");
const validateCertificatePath_js_1 = require("../helpers/validateCertificatePath.js");
const decodeCredentialPublicKey_js_1 = require("../helpers/decodeCredentialPublicKey.js");
const cose_js_1 = require("../helpers/cose.js");
/**
 * Match properties of the authenticator's attestation statement against expected values as
 * registered with the FIDO Alliance Metadata Service
 */
async function verifyAttestationWithMetadata({ statement, credentialPublicKey, x5c, attestationStatementAlg, }) {
    const { authenticationAlgorithms, authenticatorGetInfo, attestationRootCertificates, } = statement;
    // Make sure the alg in the attestation statement matches one of the ones specified in metadata
    const keypairCOSEAlgs = new Set();
    authenticationAlgorithms.forEach((algSign) => {
        // Map algSign string to { kty, alg, crv }
        const algSignCOSEINFO = exports.algSignToCOSEInfoMap[algSign];
        // Keeping this statement here just in case MDS returns something unexpected
        if (algSignCOSEINFO) {
            keypairCOSEAlgs.add(algSignCOSEINFO);
        }
    });
    // Extract the public key's COSE info for comparison
    const decodedPublicKey = (0, decodeCredentialPublicKey_js_1.decodeCredentialPublicKey)(credentialPublicKey);
    const kty = decodedPublicKey.get(cose_js_1.COSEKEYS.kty);
    const alg = decodedPublicKey.get(cose_js_1.COSEKEYS.alg);
    if (!kty) {
        throw new Error('Credential public key was missing kty');
    }
    if (!alg) {
        throw new Error('Credential public key was missing alg');
    }
    if (!kty) {
        throw new Error('Credential public key was missing kty');
    }
    // Assume everything is a number because these values should be
    const publicKeyCOSEInfo = { kty, alg };
    if ((0, cose_js_1.isCOSEPublicKeyEC2)(decodedPublicKey)) {
        const crv = decodedPublicKey.get(cose_js_1.COSEKEYS.crv);
        publicKeyCOSEInfo.crv = crv;
    }
    /**
     * Attempt to match the credential public key's algorithm to one specified in the device's
     * metadata
     */
    let foundMatch = false;
    for (const keypairAlg of keypairCOSEAlgs) {
        // Make sure algorithm and key type match
        if (keypairAlg.alg === publicKeyCOSEInfo.alg &&
            keypairAlg.kty === publicKeyCOSEInfo.kty) {
            // If not an RSA keypair then make sure curve numbers match too
            if ((keypairAlg.kty === cose_js_1.COSEKTY.EC2 || keypairAlg.kty === cose_js_1.COSEKTY.OKP) &&
                keypairAlg.crv === publicKeyCOSEInfo.crv) {
                foundMatch = true;
            }
            else {
                // We've matched an RSA public key's properties
                foundMatch = true;
            }
        }
        if (foundMatch) {
            break;
        }
    }
    // Make sure the public key is one of the allowed algorithms
    if (!foundMatch) {
        /**
         * Craft some useful error output from the MDS algorithms
         *
         * Example:
         *
         * ```
         * [
         *   'rsassa_pss_sha256_raw' (COSE info: { kty: 3, alg: -37 }),
         *   'secp256k1_ecdsa_sha256_raw' (COSE info: { kty: 2, alg: -47, crv: 8 })
         * ]
         * ```
         */
        const debugMDSAlgs = authenticationAlgorithms.map((algSign) => `'${algSign}' (COSE info: ${stringifyCOSEInfo(exports.algSignToCOSEInfoMap[algSign])})`);
        const strMDSAlgs = JSON.stringify(debugMDSAlgs, null, 2).replace(/"/g, '');
        /**
         * Construct useful error output about the public key
         */
        const strPubKeyAlg = stringifyCOSEInfo(publicKeyCOSEInfo);
        throw new Error(`Public key parameters ${strPubKeyAlg} did not match any of the following metadata algorithms:\n${strMDSAlgs}`);
    }
    /**
     * Confirm the attestation statement's algorithm is one supported according to metadata
     */
    if (attestationStatementAlg !== undefined &&
        authenticatorGetInfo?.algorithms !== undefined) {
        const getInfoAlgs = authenticatorGetInfo.algorithms.map((_alg) => _alg.alg);
        if (getInfoAlgs.indexOf(attestationStatementAlg) < 0) {
            throw new Error(`Attestation statement alg ${attestationStatementAlg} did not match one of ${getInfoAlgs}`);
        }
    }
    // Prepare to check the certificate chain
    const authenticatorCerts = x5c.map(convertCertBufferToPEM_js_1.convertCertBufferToPEM);
    const statementRootCerts = attestationRootCertificates.map(convertCertBufferToPEM_js_1.convertCertBufferToPEM);
    /**
     * If an authenticator returns exactly one certificate in its x5c, and that cert is found in the
     * metadata statement then the authenticator is "self-referencing". In this case we forego
     * certificate chain validation.
     */
    let authenticatorIsSelfReferencing = false;
    if (authenticatorCerts.length === 1 &&
        statementRootCerts.indexOf(authenticatorCerts[0]) >= 0) {
        authenticatorIsSelfReferencing = true;
    }
    if (!authenticatorIsSelfReferencing) {
        try {
            await (0, validateCertificatePath_js_1.validateCertificatePath)(authenticatorCerts, statementRootCerts);
        }
        catch (err) {
            const _err = err;
            throw new Error(`Could not validate certificate path with any metadata root certificates: ${_err.message}`);
        }
    }
    return true;
}
/**
 * Convert ALG_SIGN values to COSE info
 *
 * Values pulled from `ALG_KEY_COSE` definitions in the FIDO Registry of Predefined Values
 *
 * https://fidoalliance.org/specs/common-specs/fido-registry-v2.2-ps-20220523.html#authentication-algorithms
 */
exports.algSignToCOSEInfoMap = {
    secp256r1_ecdsa_sha256_raw: { kty: 2, alg: -7, crv: 1 },
    secp256r1_ecdsa_sha256_der: { kty: 2, alg: -7, crv: 1 },
    rsassa_pss_sha256_raw: { kty: 3, alg: -37 },
    rsassa_pss_sha256_der: { kty: 3, alg: -37 },
    secp256k1_ecdsa_sha256_raw: { kty: 2, alg: -47, crv: 8 },
    secp256k1_ecdsa_sha256_der: { kty: 2, alg: -47, crv: 8 },
    rsassa_pss_sha384_raw: { kty: 3, alg: -38 },
    rsassa_pkcsv15_sha256_raw: { kty: 3, alg: -257 },
    rsassa_pkcsv15_sha384_raw: { kty: 3, alg: -258 },
    rsassa_pkcsv15_sha512_raw: { kty: 3, alg: -259 },
    rsassa_pkcsv15_sha1_raw: { kty: 3, alg: -65535 },
    secp384r1_ecdsa_sha384_raw: { kty: 2, alg: -35, crv: 2 },
    secp512r1_ecdsa_sha256_raw: { kty: 2, alg: -36, crv: 3 },
    ed25519_eddsa_sha512_raw: { kty: 1, alg: -8, crv: 6 },
};
/**
 * A helper to format COSEInfo a little nicer than we can achieve with JSON.stringify()
 *
 * Input: `{ "kty": 3, "alg": -257 }`
 *
 * Output: `"{ kty: 3, alg: -257 }"`
 */
function stringifyCOSEInfo(info) {
    const { kty, alg, crv } = info;
    let toReturn = '';
    if (kty !== cose_js_1.COSEKTY.RSA) {
        toReturn = `{ kty: ${kty}, alg: ${alg}, crv: ${crv} }`;
    }
    else {
        toReturn = `{ kty: ${kty}, alg: ${alg} }`;
    }
    return toReturn;
}
