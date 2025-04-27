import { COSEALG, COSEPublicKeyRSA } from '../../cose.js';
/**
 * Verify a signature using an RSA public key
 */
export declare function verifyRSA(opts: {
    cosePublicKey: COSEPublicKeyRSA;
    signature: Uint8Array;
    data: Uint8Array;
    shaHashOverride?: COSEALG;
}): Promise<boolean>;
//# sourceMappingURL=verifyRSA.d.ts.map