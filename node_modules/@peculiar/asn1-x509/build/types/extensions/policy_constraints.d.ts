/**
 * ```asn1
 * id-ce-policyConstraints OBJECT IDENTIFIER ::=  { id-ce 36 }
 * ```
 */
export declare const id_ce_policyConstraints = "2.5.29.36";
/**
 * ```asn1
 * SkipCerts ::= INTEGER (0..MAX)
 * ```
 */
export type SkipCerts = ArrayBuffer;
/**
 * ```asn1
 * PolicyConstraints ::= SEQUENCE {
 *   requireExplicitPolicy           [0] SkipCerts OPTIONAL,
 *   inhibitPolicyMapping            [1] SkipCerts OPTIONAL }
 * ```
 */
export declare class PolicyConstraints {
    requireExplicitPolicy?: SkipCerts;
    inhibitPolicyMapping?: SkipCerts;
    constructor(params?: Partial<PolicyConstraints>);
}
