import { convertCOSEtoPKCS } from '../../helpers/convertCOSEtoPKCS.js';
import { convertCertBufferToPEM } from '../../helpers/convertCertBufferToPEM.js';
import { validateCertificatePath } from '../../helpers/validateCertificatePath.js';
import { verifySignature } from '../../helpers/verifySignature.js';
import { isoUint8Array } from '../../helpers/iso/index.js';
import { COSEALG } from '../../helpers/cose.js';
/**
 * Verify an attestation response with fmt 'fido-u2f'
 */
export async function verifyAttestationFIDOU2F(options) {
    const { attStmt, clientDataHash, rpIdHash, credentialID, credentialPublicKey, aaguid, rootCertificates, } = options;
    const reservedByte = Uint8Array.from([0x00]);
    const publicKey = convertCOSEtoPKCS(credentialPublicKey);
    const signatureBase = isoUint8Array.concat([
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
    const aaguidToHex = Number.parseInt(isoUint8Array.toHex(aaguid), 16);
    if (aaguidToHex !== 0x00) {
        throw new Error(`AAGUID "${aaguidToHex}" was not expected value`);
    }
    try {
        // Try validating the certificate path using the root certificates set via SettingsService
        await validateCertificatePath(x5c.map(convertCertBufferToPEM), rootCertificates);
    }
    catch (err) {
        const _err = err;
        throw new Error(`${_err.message} (FIDOU2F)`);
    }
    return verifySignature({
        signature: sig,
        data: signatureBase,
        x509Certificate: x5c[0],
        hashAlgorithm: COSEALG.ES256,
    });
}
