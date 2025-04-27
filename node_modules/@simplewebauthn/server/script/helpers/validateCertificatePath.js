"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateCertificatePath = validateCertificatePath;
const asn1_schema_1 = require("@peculiar/asn1-schema");
const isCertRevoked_js_1 = require("./isCertRevoked.js");
const verifySignature_js_1 = require("./verifySignature.js");
const mapX509SignatureAlgToCOSEAlg_js_1 = require("./mapX509SignatureAlgToCOSEAlg.js");
const getCertificateInfo_js_1 = require("./getCertificateInfo.js");
const convertPEMToBytes_js_1 = require("./convertPEMToBytes.js");
/**
 * Traverse an array of PEM certificates and ensure they form a proper chain
 * @param x5cCertsPEM Typically the result of `x5c.map(convertASN1toPEM)`
 * @param trustAnchorsPEM PEM-formatted certs that an attestation statement x5c may chain back to
 */
async function validateCertificatePath(x5cCertsPEM, trustAnchorsPEM = []) {
    if (trustAnchorsPEM.length === 0) {
        // We have no trust anchors to chain back to, so skip path validation
        return true;
    }
    let invalidSubjectAndIssuerError = false;
    let certificateNotYetValidOrExpiredErrorMessage = undefined;
    for (const anchorPEM of trustAnchorsPEM) {
        try {
            const certsWithTrustAnchor = x5cCertsPEM.concat([anchorPEM]);
            await _validatePath(certsWithTrustAnchor);
            // If we successfully validated a path then there's no need to continue. Reset any existing
            // errors that were thrown by earlier trust anchors
            invalidSubjectAndIssuerError = false;
            certificateNotYetValidOrExpiredErrorMessage = undefined;
            break;
        }
        catch (err) {
            if (err instanceof InvalidSubjectAndIssuer) {
                invalidSubjectAndIssuerError = true;
            }
            else if (err instanceof CertificateNotYetValidOrExpired) {
                certificateNotYetValidOrExpiredErrorMessage = err.message;
            }
            else {
                throw err;
            }
        }
    }
    // We tried multiple trust anchors and none of them worked
    if (invalidSubjectAndIssuerError) {
        throw new InvalidSubjectAndIssuer();
    }
    else if (certificateNotYetValidOrExpiredErrorMessage) {
        throw new CertificateNotYetValidOrExpired(certificateNotYetValidOrExpiredErrorMessage);
    }
    return true;
}
/**
 * @param x5cCerts X.509 `x5c` certs in PEM string format
 * @param anchorCert X.509 trust anchor cert in PEM string format
 */
async function _validatePath(x5cCertsWithTrustAnchorPEM) {
    if (new Set(x5cCertsWithTrustAnchorPEM).size !== x5cCertsWithTrustAnchorPEM.length) {
        throw new Error('Invalid certificate path: found duplicate certificates');
    }
    // Make sure no certs are revoked, and all are within their time validity window
    for (const certificatePEM of x5cCertsWithTrustAnchorPEM) {
        const certInfo = (0, getCertificateInfo_js_1.getCertificateInfo)((0, convertPEMToBytes_js_1.convertPEMToBytes)(certificatePEM));
        await assertCertNotRevoked(certInfo.parsedCertificate);
        assertCertIsWithinValidTimeWindow(certInfo, certificatePEM);
    }
    // Make sure each x5c cert is issued by the next certificate in the chain
    for (let i = 0; i < (x5cCertsWithTrustAnchorPEM.length - 1); i += 1) {
        const subjectPem = x5cCertsWithTrustAnchorPEM[i];
        const issuerPem = x5cCertsWithTrustAnchorPEM[i + 1];
        const subjectInfo = (0, getCertificateInfo_js_1.getCertificateInfo)((0, convertPEMToBytes_js_1.convertPEMToBytes)(subjectPem));
        const issuerInfo = (0, getCertificateInfo_js_1.getCertificateInfo)((0, convertPEMToBytes_js_1.convertPEMToBytes)(issuerPem));
        // Make sure subject issuer is issuer subject
        if (subjectInfo.issuer.combined !== issuerInfo.subject.combined) {
            throw new InvalidSubjectAndIssuer();
        }
        const issuerCertIsRootCert = issuerInfo.issuer.combined === issuerInfo.subject.combined;
        await assertSubjectIsSignedByIssuer(subjectInfo.parsedCertificate, issuerPem);
        // Perform one final check if the issuer cert is also a root certificate
        if (issuerCertIsRootCert) {
            await assertSubjectIsSignedByIssuer(issuerInfo.parsedCertificate, issuerPem);
        }
    }
    return true;
}
/**
 * Check if the certificate is revoked or not. If it is, raise an error
 */
async function assertCertNotRevoked(certificate) {
    // Check for certificate revocation
    const subjectCertRevoked = await (0, isCertRevoked_js_1.isCertRevoked)(certificate);
    if (subjectCertRevoked) {
        throw new Error(`Found revoked certificate in certificate path`);
    }
}
/**
 * Require the cert to be within its notBefore and notAfter time window
 *
 * @param certInfo Parsed cert information
 * @param certPEM PEM-formatted certificate, for error reporting
 */
function assertCertIsWithinValidTimeWindow(certInfo, certPEM) {
    const { notBefore, notAfter } = certInfo;
    const now = new Date(Date.now());
    if (notBefore > now || notAfter < now) {
        throw new CertificateNotYetValidOrExpired(`Certificate is not yet valid or expired: ${certPEM}`);
    }
}
/**
 * Ensure that the subject cert has been signed by the next cert in the chain
 */
async function assertSubjectIsSignedByIssuer(subjectCert, issuerPEM) {
    // Verify the subject certificate's signature with the issuer cert's public key
    const data = asn1_schema_1.AsnSerializer.serialize(subjectCert.tbsCertificate);
    const signature = subjectCert.signatureValue;
    const signatureAlgorithm = (0, mapX509SignatureAlgToCOSEAlg_js_1.mapX509SignatureAlgToCOSEAlg)(subjectCert.signatureAlgorithm.algorithm);
    const issuerCertBytes = (0, convertPEMToBytes_js_1.convertPEMToBytes)(issuerPEM);
    const verified = await (0, verifySignature_js_1.verifySignature)({
        data: new Uint8Array(data),
        signature: new Uint8Array(signature),
        x509Certificate: issuerCertBytes,
        hashAlgorithm: signatureAlgorithm,
    });
    if (!verified) {
        throw new InvalidSubjectSignatureForIssuer();
    }
}
// Custom errors to help pass on certain errors
class InvalidSubjectAndIssuer extends Error {
    constructor() {
        const message = 'Subject issuer did not match issuer subject';
        super(message);
        this.name = 'InvalidSubjectAndIssuer';
    }
}
class InvalidSubjectSignatureForIssuer extends Error {
    constructor() {
        const message = 'Subject signature was invalid for issuer';
        super(message);
        this.name = 'InvalidSubjectSignatureForIssuer';
    }
}
class CertificateNotYetValidOrExpired extends Error {
    constructor(message) {
        super(message);
        this.name = 'CertificateNotYetValidOrExpired';
    }
}
