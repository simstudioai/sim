/**
 * ```asn1
 * RSAPublicKey ::= SEQUENCE {
 *   modulus           INTEGER,  -- n
 *   publicExponent    INTEGER   -- e
 * }
 * ```
 */
export declare class RSAPublicKey {
    modulus: ArrayBuffer;
    publicExponent: ArrayBuffer;
    constructor(params?: Partial<RSAPublicKey>);
}
