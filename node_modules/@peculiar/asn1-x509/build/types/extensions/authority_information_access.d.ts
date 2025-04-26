import { AsnArray } from "@peculiar/asn1-schema";
import { GeneralName } from "../general_name";
/***
 * ```asn1
 * id-pe-authorityInfoAccess OBJECT IDENTIFIER ::= { id-pe 1 }
 * ```
 */
export declare const id_pe_authorityInfoAccess = "1.3.6.1.5.5.7.1.1";
/**
 * ```asn1
 * AccessDescription  ::=  SEQUENCE {
 *   accessMethod          OBJECT IDENTIFIER,
 *   accessLocation        GeneralName  }
 * ```
 */
export declare class AccessDescription {
    accessMethod: string;
    accessLocation: GeneralName;
    constructor(params?: Partial<AccessDescription>);
}
/**
 * ```asn1
 * AuthorityInfoAccessSyntax  ::=
 *   SEQUENCE SIZE (1..MAX) OF AccessDescription
 * ```
 */
export declare class AuthorityInfoAccessSyntax extends AsnArray<AccessDescription> {
    constructor(items?: AccessDescription[]);
}
