import { AsnArray } from "@peculiar/asn1-schema";
import { Attribute } from "../attribute";
/**
 * ```asn1
 * id-ce-subjectDirectoryAttributes OBJECT IDENTIFIER ::=  { id-ce 9 }
 * ```
 */
export declare const id_ce_subjectDirectoryAttributes = "2.5.29.9";
/**
 * ```asn1
 * SubjectDirectoryAttributes ::= SEQUENCE SIZE (1..MAX) OF Attribute
 * ```
 */
export declare class SubjectDirectoryAttributes extends AsnArray<Attribute> {
    constructor(items?: Attribute[]);
}
