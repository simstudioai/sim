import { GeneralNames } from "../general_names";
import { GeneralName } from "../general_name";
/**
 * ```asn1
 * id-ce-subjectAltName OBJECT IDENTIFIER ::=  { id-ce 17 }
 * ```
 */
export declare const id_ce_subjectAltName = "2.5.29.17";
/**
 * ```asn1
 * SubjectAltName ::= GeneralNames
 * ```
 */
export declare class SubjectAlternativeName extends GeneralNames {
    constructor(items?: GeneralName[]);
}
