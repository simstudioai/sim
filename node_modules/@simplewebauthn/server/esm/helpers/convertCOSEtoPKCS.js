import { isoCBOR, isoUint8Array } from './iso/index.js';
import { COSEKEYS } from './cose.js';
/**
 * Takes COSE-encoded public key and converts it to PKCS key
 */
export function convertCOSEtoPKCS(cosePublicKey) {
    // This is a little sloppy, I'm using COSEPublicKeyEC2 since it could have both x and y, but when
    // there's no y it means it's probably better typed as COSEPublicKeyOKP. I'll leave this for now
    // and revisit it later if it ever becomes an actual problem.
    const struct = isoCBOR.decodeFirst(cosePublicKey);
    const tag = Uint8Array.from([0x04]);
    const x = struct.get(COSEKEYS.x);
    const y = struct.get(COSEKEYS.y);
    if (!x) {
        throw new Error('COSE public key was missing x');
    }
    if (y) {
        return isoUint8Array.concat([tag, x, y]);
    }
    return isoUint8Array.concat([tag, x]);
}
