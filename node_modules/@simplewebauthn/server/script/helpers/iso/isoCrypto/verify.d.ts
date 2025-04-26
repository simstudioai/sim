import { COSEALG, COSEPublicKey } from '../../cose.js';
/**
 * Verify signatures with their public key. Supports EC2 and RSA public keys.
 */
export declare function verify(opts: {
    cosePublicKey: COSEPublicKey;
    signature: Uint8Array;
    data: Uint8Array;
    shaHashOverride?: COSEALG;
}): Promise<boolean>;
//# sourceMappingURL=verify.d.ts.map