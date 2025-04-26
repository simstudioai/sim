import { IAsnConverter } from "@peculiar/asn1-schema";
import { DirectoryString, Name } from "./name";
export declare const AsnIpConverter: IAsnConverter<string>;
/**
 * ```asn1
 * OtherName ::= SEQUENCE {
 *   type-id    OBJECT IDENTIFIER,
 *   value      [0] EXPLICIT ANY DEFINED BY type-id }
 * ```
 */
export declare class OtherName {
    typeId: string;
    value: ArrayBuffer;
    constructor(params?: Partial<OtherName>);
}
/**
 * ```asn1
 * EDIPartyName ::= SEQUENCE {
 *   nameAssigner            [0]     DirectoryString OPTIONAL,
 *   partyName               [1]     DirectoryString }
 * ```
 */
export declare class EDIPartyName {
    nameAssigner?: DirectoryString;
    partyName: DirectoryString;
    constructor(params?: Partial<EDIPartyName>);
}
/**
 * ```asn1
 * GeneralName ::= CHOICE {
 *   otherName                       [0]     OtherName,
 *   rfc822Name                      [1]     IA5String,
 *   dNSName                         [2]     IA5String,
 *   x400Address                     [3]     ORAddress,
 *   directoryName                   [4]     Name,
 *   ediPartyName                    [5]     EDIPartyName,
 *   uniformResourceIdentifier       [6]     IA5String,
 *   iPAddress                       [7]     OCTET STRING,
 *   registeredID                    [8]     OBJECT IDENTIFIER }
 * ```
 */
export declare class GeneralName {
    otherName?: OtherName;
    rfc822Name?: string;
    dNSName?: string;
    x400Address?: ArrayBuffer;
    directoryName?: Name;
    ediPartyName?: EDIPartyName;
    uniformResourceIdentifier?: string;
    iPAddress?: string;
    registeredID?: string;
    /**
     *
     * @param params
     */
    constructor(params?: Partial<GeneralName>);
}
