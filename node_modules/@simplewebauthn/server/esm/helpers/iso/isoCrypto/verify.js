import { COSEKEYS, isCOSECrv, isCOSEPublicKeyEC2, isCOSEPublicKeyOKP, isCOSEPublicKeyRSA, } from '../../cose.js';
import { verifyEC2 } from './verifyEC2.js';
import { verifyRSA } from './verifyRSA.js';
import { verifyOKP } from './verifyOKP.js';
import { unwrapEC2Signature } from './unwrapEC2Signature.js';
/**
 * Verify signatures with their public key. Supports EC2 and RSA public keys.
 */
export function verify(opts) {
    const { cosePublicKey, signature, data, shaHashOverride } = opts;
    if (isCOSEPublicKeyEC2(cosePublicKey)) {
        const crv = cosePublicKey.get(COSEKEYS.crv);
        if (!isCOSECrv(crv)) {
            throw new Error(`unknown COSE curve ${crv}`);
        }
        const unwrappedSignature = unwrapEC2Signature(signature, crv);
        return verifyEC2({
            cosePublicKey,
            signature: unwrappedSignature,
            data,
            shaHashOverride,
        });
    }
    else if (isCOSEPublicKeyRSA(cosePublicKey)) {
        return verifyRSA({ cosePublicKey, signature, data, shaHashOverride });
    }
    else if (isCOSEPublicKeyOKP(cosePublicKey)) {
        return verifyOKP({ cosePublicKey, signature, data });
    }
    const kty = cosePublicKey.get(COSEKEYS.kty);
    throw new Error(`Signature verification with public key of kty ${kty} is not supported by this method`);
}
