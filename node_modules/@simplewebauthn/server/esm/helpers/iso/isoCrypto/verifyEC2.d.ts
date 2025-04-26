import { COSEALG, COSEPublicKeyEC2 } from '../../cose.js';
/**
 * Verify a signature using an EC2 public key
 */
export declare function verifyEC2(opts: {
    cosePublicKey: COSEPublicKeyEC2;
    signature: Uint8Array;
    data: Uint8Array;
    shaHashOverride?: COSEALG;
}): Promise<boolean>;
//# sourceMappingURL=verifyEC2.d.ts.map