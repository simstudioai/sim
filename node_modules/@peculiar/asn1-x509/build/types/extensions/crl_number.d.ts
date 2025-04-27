/**
 * ```asn1
 * id-ce-cRLNumber OBJECT IDENTIFIER ::= { id-ce 20 }
 * ```
 */
export declare const id_ce_cRLNumber = "2.5.29.20";
/**
 * ```asn1
 * CRLNumber ::= INTEGER (0..MAX)
 * ```
 */
export declare class CRLNumber {
    value: number;
    constructor(value?: number);
}
