/**
 * Cut up a TPM attestation's certInfo into intelligible chunks
 */
export declare function parseCertInfo(certInfo: Uint8Array): ParsedCertInfo;
type ParsedCertInfo = {
    magic: number;
    type: string;
    qualifiedSigner: Uint8Array;
    extraData: Uint8Array;
    clockInfo: {
        clock: Uint8Array;
        resetCount: number;
        restartCount: number;
        safe: boolean;
    };
    firmwareVersion: Uint8Array;
    attested: {
        nameAlg: string;
        nameAlgBuffer: Uint8Array;
        name: Uint8Array;
        qualifiedName: Uint8Array;
    };
};
export {};
//# sourceMappingURL=parseCertInfo.d.ts.map