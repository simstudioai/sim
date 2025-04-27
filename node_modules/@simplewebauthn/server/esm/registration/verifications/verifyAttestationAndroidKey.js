import { AsnParser } from '@peculiar/asn1-schema';
import { Certificate } from '@peculiar/asn1-x509';
import { id_ce_keyDescription, KeyDescription } from '@peculiar/asn1-android';
import { convertCertBufferToPEM } from '../../helpers/convertCertBufferToPEM.js';
import { validateCertificatePath } from '../../helpers/validateCertificatePath.js';
import { verifySignature } from '../../helpers/verifySignature.js';
import { convertCOSEtoPKCS } from '../../helpers/convertCOSEtoPKCS.js';
import { isCOSEAlg } from '../../helpers/cose.js';
import { isoUint8Array } from '../../helpers/iso/index.js';
import { MetadataService } from '../../services/metadataService.js';
import { verifyAttestationWithMetadata } from '../../metadata/verifyAttestationWithMetadata.js';
/**
 * Verify an attestation response with fmt 'android-key'
 */
export async function verifyAttestationAndroidKey(options) {
    const { authData, clientDataHash, attStmt, credentialPublicKey, aaguid, rootCertificates, } = options;
    const x5c = attStmt.get('x5c');
    const sig = attStmt.get('sig');
    const alg = attStmt.get('alg');
    if (!x5c) {
        throw new Error('No attestation certificate provided in attestation statement (Android Key)');
    }
    if (!sig) {
        throw new Error('No attestation signature provided in attestation statement (Android Key)');
    }
    if (!alg) {
        throw new Error(`Attestation statement did not contain alg (Android Key)`);
    }
    if (!isCOSEAlg(alg)) {
        throw new Error(`Attestation statement contained invalid alg ${alg} (Android Key)`);
    }
    /**
     * Verify that the public key in the first certificate in x5c matches the credentialPublicKey in
     * the attestedCredentialData in authenticatorData.
     */
    // Find the public cert in the certificate as PKCS
    const parsedCert = AsnParser.parse(x5c[0], Certificate);
    const parsedCertPubKey = new Uint8Array(parsedCert.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey);
    // Convert the credentialPublicKey to PKCS
    const credPubKeyPKCS = convertCOSEtoPKCS(credentialPublicKey);
    if (!isoUint8Array.areEqual(credPubKeyPKCS, parsedCertPubKey)) {
        throw new Error('Credential public key does not equal leaf cert public key (Android Key)');
    }
    /**
     * Verify that the attestationChallenge field in the attestation certificate extension data is
     * identical to clientDataHash.
     */
    // Find Android KeyStore Extension in certificate extensions
    const extKeyStore = parsedCert.tbsCertificate.extensions?.find((ext) => ext.extnID === id_ce_keyDescription);
    if (!extKeyStore) {
        throw new Error('Certificate did not contain extKeyStore (Android Key)');
    }
    const parsedExtKeyStore = AsnParser.parse(extKeyStore.extnValue, KeyDescription);
    // Verify extKeyStore values
    const { attestationChallenge, teeEnforced, softwareEnforced } = parsedExtKeyStore;
    if (!isoUint8Array.areEqual(new Uint8Array(attestationChallenge.buffer), clientDataHash)) {
        throw new Error('Attestation challenge was not equal to client data hash (Android Key)');
    }
    /**
     * The AuthorizationList.allApplications field is not present on either authorization list
     * (softwareEnforced nor teeEnforced), since PublicKeyCredential MUST be scoped to the RP ID.
     *
     * (i.e. These shouldn't contain the [600] tag)
     */
    if (teeEnforced.allApplications !== undefined) {
        throw new Error('teeEnforced contained "allApplications [600]" tag (Android Key)');
    }
    if (softwareEnforced.allApplications !== undefined) {
        throw new Error('teeEnforced contained "allApplications [600]" tag (Android Key)');
    }
    const statement = await MetadataService.getStatement(aaguid);
    if (statement) {
        try {
            await verifyAttestationWithMetadata({
                statement,
                credentialPublicKey,
                x5c,
                attestationStatementAlg: alg,
            });
        }
        catch (err) {
            const _err = err;
            throw new Error(`${_err.message} (Android Key)`);
        }
    }
    else {
        /**
         * Verify that x5c contains a full certificate path.
         */
        const x5cNoRootPEM = x5c.slice(0, -1).map(convertCertBufferToPEM);
        const x5cRootPEM = x5c.slice(-1).map(convertCertBufferToPEM);
        try {
            await validateCertificatePath(x5cNoRootPEM, x5cRootPEM);
        }
        catch (err) {
            const _err = err;
            throw new Error(`${_err.message} (Android Key)`);
        }
        /**
         * Make sure the root certificate is one of the Google Hardware Attestation Root certificates
         *
         * https://developer.android.com/privacy-and-security/security-key-attestation#root_certificate
         */
        if (rootCertificates.length > 0 && rootCertificates.indexOf(x5cRootPEM[0]) < 0) {
            throw new Error('x5c root certificate was not a known root certificate (Android Key)');
        }
    }
    /**
     * Verify that sig is a valid signature over the concatenation of authenticatorData and
     * clientDataHash using the public key in the first certificate in x5c with the algorithm
     * specified in alg.
     */
    const signatureBase = isoUint8Array.concat([authData, clientDataHash]);
    return verifySignature({
        signature: sig,
        data: signatureBase,
        x509Certificate: x5c[0],
        hashAlgorithm: alg,
    });
}
