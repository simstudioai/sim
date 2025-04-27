import { COSEKEYS, isCOSEAlg } from '../../cose.js';
import { mapCoseAlgToWebCryptoAlg } from './mapCoseAlgToWebCryptoAlg.js';
import { importKey } from './importKey.js';
import { isoBase64URL } from '../index.js';
import { mapCoseAlgToWebCryptoKeyAlgName } from './mapCoseAlgToWebCryptoKeyAlgName.js';
import { getWebCrypto } from './getWebCrypto.js';
/**
 * Verify a signature using an RSA public key
 */
export async function verifyRSA(opts) {
    const { cosePublicKey, signature, data, shaHashOverride } = opts;
    const WebCrypto = await getWebCrypto();
    const alg = cosePublicKey.get(COSEKEYS.alg);
    const n = cosePublicKey.get(COSEKEYS.n);
    const e = cosePublicKey.get(COSEKEYS.e);
    if (!alg) {
        throw new Error('Public key was missing alg (RSA)');
    }
    if (!isCOSEAlg(alg)) {
        throw new Error(`Public key had invalid alg ${alg} (RSA)`);
    }
    if (!n) {
        throw new Error('Public key was missing n (RSA)');
    }
    if (!e) {
        throw new Error('Public key was missing e (RSA)');
    }
    const keyData = {
        kty: 'RSA',
        alg: '',
        n: isoBase64URL.fromBuffer(n),
        e: isoBase64URL.fromBuffer(e),
        ext: false,
    };
    const keyAlgorithm = {
        name: mapCoseAlgToWebCryptoKeyAlgName(alg),
        hash: { name: mapCoseAlgToWebCryptoAlg(alg) },
    };
    const verifyAlgorithm = {
        name: mapCoseAlgToWebCryptoKeyAlgName(alg),
    };
    if (shaHashOverride) {
        keyAlgorithm.hash.name = mapCoseAlgToWebCryptoAlg(shaHashOverride);
    }
    if (keyAlgorithm.name === 'RSASSA-PKCS1-v1_5') {
        if (keyAlgorithm.hash.name === 'SHA-256') {
            keyData.alg = 'RS256';
        }
        else if (keyAlgorithm.hash.name === 'SHA-384') {
            keyData.alg = 'RS384';
        }
        else if (keyAlgorithm.hash.name === 'SHA-512') {
            keyData.alg = 'RS512';
        }
        else if (keyAlgorithm.hash.name === 'SHA-1') {
            keyData.alg = 'RS1';
        }
    }
    else if (keyAlgorithm.name === 'RSA-PSS') {
        /**
         * salt length. The default value is 20 but the convention is to use hLen, the length of the
         * output of the hash function in bytes. A salt length of zero is permitted and will result in
         * a deterministic signature value. The actual salt length used can be determined from the
         * signature value.
         *
         * From https://www.cryptosys.net/pki/manpki/pki_rsaschemes.html
         */
        let saltLength = 0;
        if (keyAlgorithm.hash.name === 'SHA-256') {
            keyData.alg = 'PS256';
            saltLength = 32; // 256 bits => 32 bytes
        }
        else if (keyAlgorithm.hash.name === 'SHA-384') {
            keyData.alg = 'PS384';
            saltLength = 48; // 384 bits => 48 bytes
        }
        else if (keyAlgorithm.hash.name === 'SHA-512') {
            keyData.alg = 'PS512';
            saltLength = 64; // 512 bits => 64 bytes
        }
        verifyAlgorithm.saltLength = saltLength;
    }
    else {
        throw new Error(`Unexpected RSA key algorithm ${alg} (${keyAlgorithm.name})`);
    }
    const key = await importKey({
        keyData,
        algorithm: keyAlgorithm,
    });
    return WebCrypto.subtle.verify(verifyAlgorithm, key, signature, data);
}
