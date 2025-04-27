/**
 * Break apart a TPM attestation's pubArea buffer
 *
 * See 12.2.4 TPMT_PUBLIC here:
 * https://trustedcomputinggroup.org/wp-content/uploads/TPM-Rev-2.0-Part-2-Structures-00.96-130315.pdf
 */
export declare function parsePubArea(pubArea: Uint8Array): ParsedPubArea;
type ParsedPubArea = {
    type: 'TPM_ALG_RSA' | 'TPM_ALG_ECC';
    nameAlg: string;
    objectAttributes: {
        fixedTPM: boolean;
        stClear: boolean;
        fixedParent: boolean;
        sensitiveDataOrigin: boolean;
        userWithAuth: boolean;
        adminWithPolicy: boolean;
        noDA: boolean;
        encryptedDuplication: boolean;
        restricted: boolean;
        decrypt: boolean;
        signOrEncrypt: boolean;
    };
    authPolicy: Uint8Array;
    parameters: {
        rsa?: RSAParameters;
        ecc?: ECCParameters;
    };
    unique: Uint8Array;
};
type RSAParameters = {
    symmetric: string;
    scheme: string;
    keyBits: number;
    exponent: number;
};
type ECCParameters = {
    symmetric: string;
    scheme: string;
    curveID: string;
    kdf: string;
};
export {};
//# sourceMappingURL=parsePubArea.d.ts.map