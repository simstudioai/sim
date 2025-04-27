/**
 * ```asn1
 * ECDSA-Sig-Value ::= SEQUENCE {
 *   r  INTEGER,
 *   s  INTEGER
 * }
 * ```
 */
export declare class ECDSASigValue {
    r: ArrayBuffer;
    s: ArrayBuffer;
    constructor(params?: Partial<ECDSASigValue>);
}
