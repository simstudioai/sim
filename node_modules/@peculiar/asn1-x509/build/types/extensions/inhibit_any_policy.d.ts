/**
 * ```asn1
 * id-ce-inhibitAnyPolicy OBJECT IDENTIFIER ::=  { id-ce 54 }
 * ```
 */
export declare const id_ce_inhibitAnyPolicy = "2.5.29.54";
/**
 * ```asn1
 * InhibitAnyPolicy ::= SkipCerts
 * ```
 */
export declare class InhibitAnyPolicy {
    value: ArrayBuffer;
    constructor(value?: ArrayBuffer);
}
