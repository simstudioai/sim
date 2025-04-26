import { AsnArray } from "@peculiar/asn1-schema";
/**
 * ```asn1
 * AttributeType ::= OBJECT IDENTIFIER
 * ```
 */
export type AttributeType = string;
/**
 * ```asn1
 * DirectoryString ::= CHOICE {
 *       teletexString           TeletexString (SIZE (1..MAX)),
 *       printableString         PrintableString (SIZE (1..MAX)),
 *       universalString         UniversalString (SIZE (1..MAX)),
 *       utf8String              UTF8String (SIZE (1..MAX)),
 *       bmpString               BMPString (SIZE (1..MAX)) }
 * ```
 */
export declare class DirectoryString {
    teletexString?: string;
    printableString?: string;
    universalString?: string;
    utf8String?: string;
    bmpString?: string;
    constructor(params?: Partial<DirectoryString>);
    /**
     * Returns a string representation of an object.
     */
    toString(): string;
}
/**
 * ```asn1
 * AttributeValue ::= ANY -- DEFINED BY AttributeType
 * in general it will be a DirectoryString
 * ```
 */
export declare class AttributeValue extends DirectoryString {
    ia5String?: string;
    anyValue?: ArrayBuffer;
    constructor(params?: Partial<AttributeValue>);
    toString(): string;
}
/**
 * ```asn1
 * AttributeTypeAndValue ::= SEQUENCE {
 *   type     AttributeType,
 *   value    AttributeValue }
 * ```
 */
export declare class AttributeTypeAndValue {
    type: string;
    value: AttributeValue;
    constructor(params?: Partial<AttributeTypeAndValue>);
}
/**
 * ```asn1
 * RelativeDistinguishedName ::= SET SIZE (1..MAX) OF AttributeTypeAndValue
 * ```
 */
export declare class RelativeDistinguishedName extends AsnArray<AttributeTypeAndValue> {
    constructor(items?: AttributeTypeAndValue[]);
}
/**
 * ```asn1
 * RDNSequence ::= SEQUENCE OF RelativeDistinguishedName
 * ```
 */
export declare class RDNSequence extends AsnArray<RelativeDistinguishedName> {
    constructor(items?: RelativeDistinguishedName[]);
}
/**
 * ```asn1
 * Name ::= CHOICE { -- only one possibility for now --
 *   rdnSequence  RDNSequence }
 * ```
 */
export declare class Name extends RDNSequence {
    constructor(items?: RelativeDistinguishedName[]);
}
