import { AsnArray } from "@peculiar/asn1-schema";
import { AccessDescription } from "./authority_information_access";
/**
 * ```asn1
 * id-pe-subjectInfoAccess OBJECT IDENTIFIER ::= { id-pe 11 }
 * ```
 */
export declare const id_pe_subjectInfoAccess = "1.3.6.1.5.5.7.1.11";
/**
 * ```asn1
 * SubjectInfoAccessSyntax  ::=
 *         SEQUENCE SIZE (1..MAX) OF AccessDescription
 * ```
 */
export declare class SubjectInfoAccessSyntax extends AsnArray<AccessDescription> {
    constructor(items?: AccessDescription[]);
}
