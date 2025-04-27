import { BitString } from "@peculiar/asn1-schema";
/**
 * ```asn1
 * id-ce-keyUsage OBJECT IDENTIFIER ::=  { id-ce 15 }
 * ```
 */
export declare const id_ce_keyUsage = "2.5.29.15";
export type KeyUsageType = "digitalSignature" | "nonRepudiation" | "keyEncipherment" | "dataEncipherment" | "keyAgreement" | "keyCertSign" | "crlSign" | "encipherOnly" | "decipherOnly";
export declare enum KeyUsageFlags {
    digitalSignature = 1,
    nonRepudiation = 2,
    keyEncipherment = 4,
    dataEncipherment = 8,
    keyAgreement = 16,
    keyCertSign = 32,
    cRLSign = 64,
    encipherOnly = 128,
    decipherOnly = 256
}
/**
 * ```asn1
 * KeyUsage ::= BIT STRING {
 *   digitalSignature        (0),
 *   nonRepudiation          (1), -- recent editions of X.509 have
 *                        -- renamed this bit to contentCommitment
 *   keyEncipherment         (2),
 *   dataEncipherment        (3),
 *   keyAgreement            (4),
 *   keyCertSign             (5),
 *   cRLSign                 (6),
 *   encipherOnly            (7),
 *   decipherOnly            (8) }
 * ```
 */
export declare class KeyUsage extends BitString {
    toJSON(): KeyUsageType[];
    toString(): string;
}
