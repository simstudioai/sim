import { COSEPublicKeyOKP } from '../../cose.js';
export declare function verifyOKP(opts: {
    cosePublicKey: COSEPublicKeyOKP;
    signature: Uint8Array;
    data: Uint8Array;
}): Promise<boolean>;
//# sourceMappingURL=verifyOKP.d.ts.map