import { isoCrypto } from './iso/index.js';
import { decodeCredentialPublicKey } from './decodeCredentialPublicKey.js';
import { convertX509PublicKeyToCOSE } from './convertX509PublicKeyToCOSE.js';
/**
 * Verify an authenticator's signature
 */
export function verifySignature(opts) {
    const { signature, data, credentialPublicKey, x509Certificate, hashAlgorithm, } = opts;
    if (!x509Certificate && !credentialPublicKey) {
        throw new Error('Must declare either "leafCert" or "credentialPublicKey"');
    }
    if (x509Certificate && credentialPublicKey) {
        throw new Error('Must not declare both "leafCert" and "credentialPublicKey"');
    }
    let cosePublicKey = new Map();
    if (credentialPublicKey) {
        cosePublicKey = decodeCredentialPublicKey(credentialPublicKey);
    }
    else if (x509Certificate) {
        cosePublicKey = convertX509PublicKeyToCOSE(x509Certificate);
    }
    return _verifySignatureInternals.stubThis(isoCrypto.verify({
        cosePublicKey,
        signature,
        data,
        shaHashOverride: hashAlgorithm,
    }));
}
/**
 * Make it possible to stub the return value during testing
 * @ignore Don't include this in docs output
 */
export const _verifySignatureInternals = {
    stubThis: (value) => value,
};
