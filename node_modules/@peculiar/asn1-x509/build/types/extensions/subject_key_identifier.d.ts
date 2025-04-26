import { KeyIdentifier } from "./authority_key_identifier";
/**
 * ```asn1
 * id-ce-subjectKeyIdentifier OBJECT IDENTIFIER ::=  { id-ce 14 }
 * ```
 */
export declare const id_ce_subjectKeyIdentifier = "2.5.29.14";
/**
 * ```asn1
 * SubjectKeyIdentifier ::= KeyIdentifier
 * ```
 */
export declare class SubjectKeyIdentifier extends KeyIdentifier {
}
