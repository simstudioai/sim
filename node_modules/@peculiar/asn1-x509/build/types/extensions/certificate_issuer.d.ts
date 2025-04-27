import { GeneralNames } from "../general_names";
import { GeneralName } from "../general_name";
/**
 * ```asn1
 * id-ce-certificateIssuer   OBJECT IDENTIFIER ::= { id-ce 29 }
 * ```
 */
export declare const id_ce_certificateIssuer = "2.5.29.29";
/**
 * ```asn1
 * CertificateIssuer ::=     GeneralNames
 * ```
 */
export declare class CertificateIssuer extends GeneralNames {
    constructor(items?: GeneralName[]);
}
