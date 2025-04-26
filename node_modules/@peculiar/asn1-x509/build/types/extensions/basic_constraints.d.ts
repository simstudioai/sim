/**
 * ```asn1
 * id-ce-basicConstraints OBJECT IDENTIFIER ::=  { id-ce 19 }
 * ```
 */
export declare const id_ce_basicConstraints = "2.5.29.19";
/**
 * ```asn1
 * BasicConstraints ::= SEQUENCE {
 *     cA                      BOOLEAN DEFAULT FALSE,
 *     pathLenConstraint       INTEGER (0..MAX) OPTIONAL }
 * ```
 */
export declare class BasicConstraints {
    cA: boolean;
    pathLenConstraint?: number;
    constructor(params?: Partial<BasicConstraints>);
}
