import { BitString } from "@peculiar/asn1-schema";
/**
 * ```asn1
 * id-entrust-entrustVersInfo      OBJECT IDENTIFIER ::= {iso(1)
 *   member-body(2) us(840) nortelnetworks(113533) entrust(7)
 *   nsn-ce(65) 0}
 * ```
 */
export declare const id_entrust_entrustVersInfo = "1.2.840.113533.7.65.0";
export type EntrustInfoType = "keyUpdateAllowed" | "newExtensions" | "pKIXCertificate";
export declare enum EntrustInfoFlags {
    keyUpdateAllowed = 1,
    newExtensions = 2,
    pKIXCertificate = 4
}
/**
 * ```asn1
 * EntrustInfoFlags ::= BIT STRING {
 *   keyUpdateAllowed        (0),
 *   newExtensions           (1),  -- not used
 *   pKIXCertificate         (2) } -- certificate created by pkix
 * ```
 */
export declare class EntrustInfo extends BitString {
    toJSON(): EntrustInfoType[];
    toString(): string;
}
/**
 * ```asn1
 * EntrustVersionInfo ::= SEQUENCE {
 *     entrustVers	GeneralString,
 *     entrustInfoFlags	EntrustInfoFlags }
 * ```
 */
export declare class EntrustVersionInfo {
    entrustVers: string;
    entrustInfoFlags: EntrustInfo;
    constructor(params?: Partial<EntrustVersionInfo>);
}
