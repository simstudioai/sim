import { COSECRV, COSEKEYS, isCOSEAlg } from '../../cose.js';
import { isoBase64URL } from '../../index.js';
import { importKey } from './importKey.js';
import { getWebCrypto } from './getWebCrypto.js';
export async function verifyOKP(opts) {
    const { cosePublicKey, signature, data } = opts;
    const WebCrypto = await getWebCrypto();
    const alg = cosePublicKey.get(COSEKEYS.alg);
    const crv = cosePublicKey.get(COSEKEYS.crv);
    const x = cosePublicKey.get(COSEKEYS.x);
    if (!alg) {
        throw new Error('Public key was missing alg (OKP)');
    }
    if (!isCOSEAlg(alg)) {
        throw new Error(`Public key had invalid alg ${alg} (OKP)`);
    }
    if (!crv) {
        throw new Error('Public key was missing crv (OKP)');
    }
    if (!x) {
        throw new Error('Public key was missing x (OKP)');
    }
    // Pulled key import steps from here:
    // https://wicg.github.io/webcrypto-secure-curves/#ed25519-operations
    let _crv;
    if (crv === COSECRV.ED25519) {
        _crv = 'Ed25519';
    }
    else {
        throw new Error(`Unexpected COSE crv value of ${crv} (OKP)`);
    }
    const keyData = {
        kty: 'OKP',
        crv: _crv,
        alg: 'EdDSA',
        x: isoBase64URL.fromBuffer(x),
        ext: false,
    };
    const keyAlgorithm = {
        name: _crv,
        namedCurve: _crv,
    };
    const key = await importKey({
        keyData,
        algorithm: keyAlgorithm,
    });
    const verifyAlgorithm = {
        name: _crv,
    };
    return WebCrypto.subtle.verify(verifyAlgorithm, key, signature, data);
}
