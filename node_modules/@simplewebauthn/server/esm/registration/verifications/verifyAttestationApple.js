import { AsnParser } from '@peculiar/asn1-schema';
import { Certificate } from '@peculiar/asn1-x509';
import { validateCertificatePath } from '../../helpers/validateCertificatePath.js';
import { convertCertBufferToPEM } from '../../helpers/convertCertBufferToPEM.js';
import { toHash } from '../../helpers/toHash.js';
import { convertCOSEtoPKCS } from '../../helpers/convertCOSEtoPKCS.js';
import { isoUint8Array } from '../../helpers/iso/index.js';
export async function verifyAttestationApple(options) {
    const { attStmt, authData, clientDataHash, credentialPublicKey, rootCertificates, } = options;
    const x5c = attStmt.get('x5c');
    if (!x5c) {
        throw new Error('No attestation certificate provided in attestation statement (Apple)');
    }
    /**
     * Verify certificate path
     */
    try {
        await validateCertificatePath(x5c.map(convertCertBufferToPEM), rootCertificates);
    }
    catch (err) {
        const _err = err;
        throw new Error(`${_err.message} (Apple)`);
    }
    /**
     * Compare nonce in certificate extension to computed nonce
     */
    const parsedCredCert = AsnParser.parse(x5c[0], Certificate);
    const { extensions, subjectPublicKeyInfo } = parsedCredCert.tbsCertificate;
    if (!extensions) {
        throw new Error('credCert missing extensions (Apple)');
    }
    const extCertNonce = extensions.find((ext) => ext.extnID === '1.2.840.113635.100.8.2');
    if (!extCertNonce) {
        throw new Error('credCert missing "1.2.840.113635.100.8.2" extension (Apple)');
    }
    const nonceToHash = isoUint8Array.concat([authData, clientDataHash]);
    const nonce = await toHash(nonceToHash);
    /**
     * Ignore the first six ASN.1 structure bytes that define the nonce as an OCTET STRING. Should
     * trim off <Buffer 30 24 a1 22 04 20>
     *
     * TODO: Try and get @peculiar (GitHub) to add a schema for "1.2.840.113635.100.8.2" when we
     * find out where it's defined (doesn't seem to be publicly documented at the moment...)
     */
    const extNonce = new Uint8Array(extCertNonce.extnValue.buffer).slice(6);
    if (!isoUint8Array.areEqual(nonce, extNonce)) {
        throw new Error(`credCert nonce was not expected value (Apple)`);
    }
    /**
     * Verify credential public key matches the Subject Public Key of credCert
     */
    const credPubKeyPKCS = convertCOSEtoPKCS(credentialPublicKey);
    const credCertSubjectPublicKey = new Uint8Array(subjectPublicKeyInfo.subjectPublicKey);
    if (!isoUint8Array.areEqual(credPubKeyPKCS, credCertSubjectPublicKey)) {
        throw new Error('Credential public key does not equal credCert public key (Apple)');
    }
    return true;
}
