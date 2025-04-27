import { AsnArray } from "@peculiar/asn1-schema";
/**
 * ```asn1
 * OtherPrimeInfo ::= SEQUENCE {
 *     prime             INTEGER,  -- ri
 *     exponent          INTEGER,  -- di
 *     coefficient       INTEGER   -- ti
 * }
 * ```
 */
export declare class OtherPrimeInfo {
    prime: ArrayBuffer;
    exponent: ArrayBuffer;
    coefficient: ArrayBuffer;
    constructor(params?: Partial<OtherPrimeInfo>);
}
/**
 * ```asn1
 * OtherPrimeInfos ::= SEQUENCE SIZE(1..MAX) OF OtherPrimeInfo
 * ```
 */
export declare class OtherPrimeInfos extends AsnArray<OtherPrimeInfo> {
    constructor(items?: OtherPrimeInfo[]);
}
