/**
 * ```asn1
 * id-ce-invalidityDate OBJECT IDENTIFIER ::= { id-ce 24 }
 * ```
 */
export declare const id_ce_invalidityDate = "2.5.29.24";
/**
 * ```asn1
 * InvalidityDate ::=  GeneralizedTime
 * ```
 */
export declare class InvalidityDate {
    value: Date;
    constructor(value?: Date);
}
