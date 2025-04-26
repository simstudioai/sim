/**
 * A whole lotta domain knowledge is captured here, with hazy connections to source
 * documents. Good places to start searching for more info on these values are the
 * following Trusted Computing Group TPM Library docs linked in the WebAuthn API:
 *
 * - https://www.trustedcomputinggroup.org/wp-content/uploads/TPM-Rev-2.0-Part-1-Architecture-01.38.pdf
 * - https://www.trustedcomputinggroup.org/wp-content/uploads/TPM-Rev-2.0-Part-2-Structures-01.38.pdf
 * - https://www.trustedcomputinggroup.org/wp-content/uploads/TPM-Rev-2.0-Part-3-Commands-01.38.pdf
 */
/**
 * 6.9 TPM_ST (Structure Tags)
 */
export declare const TPM_ST: {
    [key: number]: string;
};
/**
 * 6.3 TPM_ALG_ID
 */
export declare const TPM_ALG: {
    [key: number]: string;
};
/**
 * 6.4 TPM_ECC_CURVE
 */
export declare const TPM_ECC_CURVE: {
    [key: number]: string;
};
type ManufacturerInfo = {
    name: string;
    id: string;
};
/**
 * Sourced from https://trustedcomputinggroup.org/resource/vendor-id-registry/
 *
 * Latest version:
 * https://trustedcomputinggroup.org/wp-content/uploads/TCG-TPM-Vendor-ID-Registry-Version-1.02-Revision-1.00.pdf
 */
export declare const TPM_MANUFACTURERS: {
    [key: string]: ManufacturerInfo;
};
/**
 * Match TPM public area curve ID's to `crv` numbers used in COSE public keys
 */
export declare const TPM_ECC_CURVE_COSE_CRV_MAP: {
    [key: string]: number;
};
export {};
//# sourceMappingURL=constants.d.ts.map