import { COSECRV, COSEKEYS } from '../../cose.js';
import { mapCoseAlgToWebCryptoAlg } from './mapCoseAlgToWebCryptoAlg.js';
import { importKey } from './importKey.js';
import { isoBase64URL } from '../index.js';
import { getWebCrypto } from './getWebCrypto.js';
/**
 * Verify a signature using an EC2 public key
 */
export async function verifyEC2(opts) {
    const { cosePublicKey, signature, data, shaHashOverride } = opts;
    const WebCrypto = await getWebCrypto();
    // Import the public key
    const alg = cosePublicKey.get(COSEKEYS.alg);
    const crv = cosePublicKey.get(COSEKEYS.crv);
    const x = cosePublicKey.get(COSEKEYS.x);
    const y = cosePublicKey.get(COSEKEYS.y);
    if (!alg) {
        throw new Error('Public key was missing alg (EC2)');
    }
    if (!crv) {
        throw new Error('Public key was missing crv (EC2)');
    }
    if (!x) {
        throw new Error('Public key was missing x (EC2)');
    }
    if (!y) {
        throw new Error('Public key was missing y (EC2)');
    }
    let _crv;
    if (crv === COSECRV.P256) {
        _crv = 'P-256';
    }
    else if (crv === COSECRV.P384) {
        _crv = 'P-384';
    }
    else if (crv === COSECRV.P521) {
        _crv = 'P-521';
    }
    else {
        throw new Error(`Unexpected COSE crv value of ${crv} (EC2)`);
    }
    const keyData = {
        kty: 'EC',
        crv: _crv,
        x: isoBase64URL.fromBuffer(x),
        y: isoBase64URL.fromBuffer(y),
        ext: false,
    };
    const keyAlgorithm = {
        /**
         * Note to future self: you can't use `mapCoseAlgToWebCryptoKeyAlgName()` here because some
         * leaf certs from actual devices specified an RSA SHA value for `alg` (e.g. `-257`) which
         * would then map here to `'RSASSA-PKCS1-v1_5'`. We always want `'ECDSA'` here so we'll
         * hard-code this.
         */
        name: 'ECDSA',
        namedCurve: _crv,
    };
    const key = await importKey({
        keyData,
        algorithm: keyAlgorithm,
    });
    // Determine which SHA algorithm to use for signature verification
    let subtleAlg = mapCoseAlgToWebCryptoAlg(alg);
    if (shaHashOverride) {
        subtleAlg = mapCoseAlgToWebCryptoAlg(shaHashOverride);
    }
    const verifyAlgorithm = {
        name: 'ECDSA',
        hash: { name: subtleAlg },
    };
    return WebCrypto.subtle.verify(verifyAlgorithm, key, signature, data);
}
