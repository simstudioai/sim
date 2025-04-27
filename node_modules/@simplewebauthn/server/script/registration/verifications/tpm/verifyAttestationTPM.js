"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyAttestationTPM = verifyAttestationTPM;
const asn1_schema_1 = require("@peculiar/asn1-schema");
const asn1_x509_1 = require("@peculiar/asn1-x509");
const decodeCredentialPublicKey_js_1 = require("../../../helpers/decodeCredentialPublicKey.js");
const cose_js_1 = require("../../../helpers/cose.js");
const toHash_js_1 = require("../../../helpers/toHash.js");
const convertCertBufferToPEM_js_1 = require("../../../helpers/convertCertBufferToPEM.js");
const validateCertificatePath_js_1 = require("../../../helpers/validateCertificatePath.js");
const getCertificateInfo_js_1 = require("../../../helpers/getCertificateInfo.js");
const verifySignature_js_1 = require("../../../helpers/verifySignature.js");
const index_js_1 = require("../../../helpers/iso/index.js");
const validateExtFIDOGenCEAAGUID_js_1 = require("../../../helpers/validateExtFIDOGenCEAAGUID.js");
const metadataService_js_1 = require("../../../services/metadataService.js");
const verifyAttestationWithMetadata_js_1 = require("../../../metadata/verifyAttestationWithMetadata.js");
const constants_js_1 = require("./constants.js");
const parseCertInfo_js_1 = require("./parseCertInfo.js");
const parsePubArea_js_1 = require("./parsePubArea.js");
async function verifyAttestationTPM(options) {
    const { aaguid, attStmt, authData, credentialPublicKey, clientDataHash, rootCertificates, } = options;
    const ver = attStmt.get('ver');
    const sig = attStmt.get('sig');
    const alg = attStmt.get('alg');
    const x5c = attStmt.get('x5c');
    const pubArea = attStmt.get('pubArea');
    const certInfo = attStmt.get('certInfo');
    /**
     * Verify structures
     */
    if (ver !== '2.0') {
        throw new Error(`Unexpected ver "${ver}", expected "2.0" (TPM)`);
    }
    if (!sig) {
        throw new Error('No attestation signature provided in attestation statement (TPM)');
    }
    if (!alg) {
        throw new Error(`Attestation statement did not contain alg (TPM)`);
    }
    if (!(0, cose_js_1.isCOSEAlg)(alg)) {
        throw new Error(`Attestation statement contained invalid alg ${alg} (TPM)`);
    }
    if (!x5c) {
        throw new Error('No attestation certificate provided in attestation statement (TPM)');
    }
    if (!pubArea) {
        throw new Error('Attestation statement did not contain pubArea (TPM)');
    }
    if (!certInfo) {
        throw new Error('Attestation statement did not contain certInfo (TPM)');
    }
    const parsedPubArea = (0, parsePubArea_js_1.parsePubArea)(pubArea);
    const { unique, type: pubType, parameters } = parsedPubArea;
    // Verify that the public key specified by the parameters and unique fields of pubArea is
    // identical to the credentialPublicKey in the attestedCredentialData in authenticatorData.
    const cosePublicKey = (0, decodeCredentialPublicKey_js_1.decodeCredentialPublicKey)(credentialPublicKey);
    if (pubType === 'TPM_ALG_RSA') {
        if (!(0, cose_js_1.isCOSEPublicKeyRSA)(cosePublicKey)) {
            throw new Error(`Credential public key with kty ${cosePublicKey.get(cose_js_1.COSEKEYS.kty)} did not match ${pubType}`);
        }
        const n = cosePublicKey.get(cose_js_1.COSEKEYS.n);
        const e = cosePublicKey.get(cose_js_1.COSEKEYS.e);
        if (!n) {
            throw new Error('COSE public key missing n (TPM|RSA)');
        }
        if (!e) {
            throw new Error('COSE public key missing e (TPM|RSA)');
        }
        if (!index_js_1.isoUint8Array.areEqual(unique, n)) {
            throw new Error('PubArea unique is not same as credentialPublicKey (TPM|RSA)');
        }
        if (!parameters.rsa) {
            throw new Error(`Parsed pubArea type is RSA, but missing parameters.rsa (TPM|RSA)`);
        }
        const eBuffer = e;
        // If `exponent` is equal to 0x00, then exponent is the default RSA exponent of 2^16+1 (65537)
        const pubAreaExponent = parameters.rsa.exponent || 65537;
        // Do some bit shifting to get to an integer
        const eSum = eBuffer[0] + (eBuffer[1] << 8) + (eBuffer[2] << 16);
        if (pubAreaExponent !== eSum) {
            throw new Error(`Unexpected public key exp ${eSum}, expected ${pubAreaExponent} (TPM|RSA)`);
        }
    }
    else if (pubType === 'TPM_ALG_ECC') {
        if (!(0, cose_js_1.isCOSEPublicKeyEC2)(cosePublicKey)) {
            throw new Error(`Credential public key with kty ${cosePublicKey.get(cose_js_1.COSEKEYS.kty)} did not match ${pubType}`);
        }
        const crv = cosePublicKey.get(cose_js_1.COSEKEYS.crv);
        const x = cosePublicKey.get(cose_js_1.COSEKEYS.x);
        const y = cosePublicKey.get(cose_js_1.COSEKEYS.y);
        if (!crv) {
            throw new Error('COSE public key missing crv (TPM|ECC)');
        }
        if (!x) {
            throw new Error('COSE public key missing x (TPM|ECC)');
        }
        if (!y) {
            throw new Error('COSE public key missing y (TPM|ECC)');
        }
        if (!index_js_1.isoUint8Array.areEqual(unique, index_js_1.isoUint8Array.concat([x, y]))) {
            throw new Error('PubArea unique is not same as public key x and y (TPM|ECC)');
        }
        if (!parameters.ecc) {
            throw new Error(`Parsed pubArea type is ECC, but missing parameters.ecc (TPM|ECC)`);
        }
        const pubAreaCurveID = parameters.ecc.curveID;
        const pubAreaCurveIDMapToCOSECRV = constants_js_1.TPM_ECC_CURVE_COSE_CRV_MAP[pubAreaCurveID];
        if (pubAreaCurveIDMapToCOSECRV !== crv) {
            throw new Error(`Public area key curve ID "${pubAreaCurveID}" mapped to "${pubAreaCurveIDMapToCOSECRV}" which did not match public key crv of "${crv}" (TPM|ECC)`);
        }
    }
    else {
        throw new Error(`Unsupported pubArea.type "${pubType}"`);
    }
    const parsedCertInfo = (0, parseCertInfo_js_1.parseCertInfo)(certInfo);
    const { magic, type: certType, attested, extraData } = parsedCertInfo;
    if (magic !== 0xff544347) {
        throw new Error(`Unexpected magic value "${magic}", expected "0xff544347" (TPM)`);
    }
    if (certType !== 'TPM_ST_ATTEST_CERTIFY') {
        throw new Error(`Unexpected type "${certType}", expected "TPM_ST_ATTEST_CERTIFY" (TPM)`);
    }
    // Hash pubArea to create pubAreaHash using the nameAlg in attested
    const pubAreaHash = await (0, toHash_js_1.toHash)(pubArea, attestedNameAlgToCOSEAlg(attested.nameAlg));
    // Concatenate attested.nameAlg and pubAreaHash to create attestedName.
    const attestedName = index_js_1.isoUint8Array.concat([
        attested.nameAlgBuffer,
        pubAreaHash,
    ]);
    // Check that certInfo.attested.name is equals to attestedName.
    if (!index_js_1.isoUint8Array.areEqual(attested.name, attestedName)) {
        throw new Error(`Attested name comparison failed (TPM)`);
    }
    // Concatenate authData with clientDataHash to create attToBeSigned
    const attToBeSigned = index_js_1.isoUint8Array.concat([authData, clientDataHash]);
    // Hash attToBeSigned using the algorithm specified in attStmt.alg to create attToBeSignedHash
    const attToBeSignedHash = await (0, toHash_js_1.toHash)(attToBeSigned, alg);
    // Check that certInfo.extraData is equals to attToBeSignedHash.
    if (!index_js_1.isoUint8Array.areEqual(extraData, attToBeSignedHash)) {
        throw new Error('CertInfo extra data did not equal hashed attestation (TPM)');
    }
    /**
     * Verify signature
     */
    if (x5c.length < 1) {
        throw new Error('No certificates present in x5c array (TPM)');
    }
    // Pick a leaf AIK certificate of the x5c array and parse it.
    const leafCertInfo = (0, getCertificateInfo_js_1.getCertificateInfo)(x5c[0]);
    const { basicConstraintsCA, version, subject, notAfter, notBefore } = leafCertInfo;
    if (basicConstraintsCA) {
        throw new Error('Certificate basic constraints CA was not `false` (TPM)');
    }
    // Check that certificate is of version 3 (value must be set to 2).
    if (version !== 2) {
        throw new Error('Certificate version was not `3` (ASN.1 value of 2) (TPM)');
    }
    // Check that Subject sequence is empty.
    if (subject.combined.length > 0) {
        throw new Error('Certificate subject was not empty (TPM)');
    }
    // Check that certificate is currently valid
    let now = new Date();
    if (notBefore > now) {
        throw new Error(`Certificate not good before "${notBefore.toString()}" (TPM)`);
    }
    // Check that certificate has not expired
    now = new Date();
    if (notAfter < now) {
        throw new Error(`Certificate not good after "${notAfter.toString()}" (TPM)`);
    }
    /**
     * Plumb the depths of the certificate's ASN.1-formatted data for some values we need to verify
     */
    const parsedCert = asn1_schema_1.AsnParser.parse(x5c[0], asn1_x509_1.Certificate);
    if (!parsedCert.tbsCertificate.extensions) {
        throw new Error('Certificate was missing extensions (TPM)');
    }
    let subjectAltNamePresent;
    let extKeyUsage;
    parsedCert.tbsCertificate.extensions.forEach((ext) => {
        if (ext.extnID === asn1_x509_1.id_ce_subjectAltName) {
            subjectAltNamePresent = asn1_schema_1.AsnParser.parse(ext.extnValue, asn1_x509_1.SubjectAlternativeName);
        }
        else if (ext.extnID === asn1_x509_1.id_ce_extKeyUsage) {
            extKeyUsage = asn1_schema_1.AsnParser.parse(ext.extnValue, asn1_x509_1.ExtendedKeyUsage);
        }
    });
    // Check that certificate contains subjectAltName (2.5.29.17) extension,
    if (!subjectAltNamePresent) {
        throw new Error('Certificate did not contain subjectAltName extension (TPM)');
    }
    // TPM-specific values are buried within `directoryName`, so first make sure there are values
    // there.
    if (!subjectAltNamePresent[0].directoryName?.[0].length) {
        throw new Error('Certificate subjectAltName extension directoryName was empty (TPM)');
    }
    const { tcgAtTpmManufacturer, tcgAtTpmModel, tcgAtTpmVersion } = getTcgAtTpmValues(subjectAltNamePresent[0].directoryName);
    if (!tcgAtTpmManufacturer || !tcgAtTpmModel || !tcgAtTpmVersion) {
        throw new Error('Certificate contained incomplete subjectAltName data (TPM)');
    }
    if (!extKeyUsage) {
        throw new Error('Certificate did not contain ExtendedKeyUsage extension (TPM)');
    }
    // Check that tcpaTpmManufacturer (2.23.133.2.1) field is set to a valid manufacturer ID.
    if (!constants_js_1.TPM_MANUFACTURERS[tcgAtTpmManufacturer]) {
        throw new Error(`Could not match TPM manufacturer "${tcgAtTpmManufacturer}" (TPM)`);
    }
    // Check that certificate contains extKeyUsage (2.5.29.37) extension and it must contain
    // tcg-kp-AIKCertificate (2.23.133.8.3) OID.
    if (extKeyUsage[0] !== '2.23.133.8.3') {
        throw new Error(`Unexpected extKeyUsage "${extKeyUsage[0]}", expected "2.23.133.8.3" (TPM)`);
    }
    // Validate attestation statement AAGUID against leaf cert AAGUID
    try {
        await (0, validateExtFIDOGenCEAAGUID_js_1.validateExtFIDOGenCEAAGUID)(parsedCert.tbsCertificate.extensions, aaguid);
    }
    catch (err) {
        const _err = err;
        throw new Error(`${_err.message} (TPM)`);
    }
    // Run some metadata checks if a statement exists for this authenticator
    const statement = await metadataService_js_1.MetadataService.getStatement(aaguid);
    if (statement) {
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
            throw new Error(`${_err.message} (TPM)`);
        }
    }
    else {
        try {
            // Try validating the certificate path using the root certificates set via SettingsService
            await (0, validateCertificatePath_js_1.validateCertificatePath)(x5c.map(convertCertBufferToPEM_js_1.convertCertBufferToPEM), rootCertificates);
        }
        catch (err) {
            const _err = err;
            throw new Error(`${_err.message} (TPM)`);
        }
    }
    // Verify signature over certInfo with the public key extracted from AIK certificate.
    // In the wise words of Yuriy Ackermann: "Get Martini friend, you are done!"
    return (0, verifySignature_js_1.verifySignature)({
        signature: sig,
        data: certInfo,
        x509Certificate: x5c[0],
        hashAlgorithm: alg,
    });
}
/**
 * Contain logic for pulling TPM-specific values out of subjectAlternativeName extension
 */
function getTcgAtTpmValues(root) {
    const oidManufacturer = '2.23.133.2.1';
    const oidModel = '2.23.133.2.2';
    const oidVersion = '2.23.133.2.3';
    let tcgAtTpmManufacturer;
    let tcgAtTpmModel;
    let tcgAtTpmVersion;
    /**
     * Iterate through the following potential structures:
     *
     * (Good, follows the spec)
     * https://trustedcomputinggroup.org/wp-content/uploads/TCG_IWG_EKCredentialProfile_v2p3_r2_pub.pdf (page 33)
     * Name [
     *   RelativeDistinguishedName [
     *     AttributeTypeAndValue { type, value }
     *   ]
     *   RelativeDistinguishedName [
     *     AttributeTypeAndValue { type, value }
     *   ]
     *   RelativeDistinguishedName [
     *     AttributeTypeAndValue { type, value }
     *   ]
     * ]
     *
     * (Bad, does not follow the spec)
     * Name [
     *   RelativeDistinguishedName [
     *     AttributeTypeAndValue { type, value }
     *     AttributeTypeAndValue { type, value }
     *     AttributeTypeAndValue { type, value }
     *   ]
     * ]
     *
     * Both structures have been seen in the wild and need to be supported
     */
    root.forEach((relName) => {
        relName.forEach((attr) => {
            if (attr.type === oidManufacturer) {
                tcgAtTpmManufacturer = attr.value.toString();
            }
            else if (attr.type === oidModel) {
                tcgAtTpmModel = attr.value.toString();
            }
            else if (attr.type === oidVersion) {
                tcgAtTpmVersion = attr.value.toString();
            }
        });
    });
    return {
        tcgAtTpmManufacturer,
        tcgAtTpmModel,
        tcgAtTpmVersion,
    };
}
/**
 * Convert TPM-specific SHA algorithm ID's with COSE-specific equivalents. Note that the choice to
 * use ECDSA SHA IDs is arbitrary; any such COSEALG that would map to SHA-256 in
 * `mapCoseAlgToWebCryptoAlg()`
 *
 * SHA IDs referenced from here:
 *
 * https://trustedcomputinggroup.org/wp-content/uploads/TCG_TPM2_r1p59_Part2_Structures_pub.pdf
 */
function attestedNameAlgToCOSEAlg(alg) {
    if (alg === 'TPM_ALG_SHA256') {
        return cose_js_1.COSEALG.ES256;
    }
    else if (alg === 'TPM_ALG_SHA384') {
        return cose_js_1.COSEALG.ES384;
    }
    else if (alg === 'TPM_ALG_SHA512') {
        return cose_js_1.COSEALG.ES512;
    }
    throw new Error(`Unexpected TPM attested name alg ${alg}`);
}
