import { GeneralNames } from "../general_names";
import { GeneralName } from "../general_name";
/**
 * ```asn1
 * id-ce-issuerAltName OBJECT IDENTIFIER ::=  { id-ce 18 }
 * ```
 */
export declare const id_ce_issuerAltName = "2.5.29.18";
/**
 * ```asn1
 * IssuerAltName ::= GeneralNames
 * ```
 */
export declare class IssueAlternativeName extends GeneralNames {
    constructor(items?: GeneralName[]);
}
