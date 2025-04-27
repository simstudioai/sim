import { AsnArray } from "@peculiar/asn1-schema";
/**
 * ```asn1
 * id-ce-extKeyUsage OBJECT IDENTIFIER ::= { id-ce 37 }
 * ```
 */
export declare const id_ce_extKeyUsage = "2.5.29.37";
/**
 * ```asn1
 * KeyPurposeId ::= OBJECT IDENTIFIER
 * ```
 */
export type KeyPurposeId = string;
/**
 * ```asn1
 * ExtKeyUsageSyntax ::= SEQUENCE SIZE (1..MAX) OF KeyPurposeId
 * ```
 */
export declare class ExtendedKeyUsage extends AsnArray<string> {
    constructor(items?: string[]);
}
/**
 * ```asn1
 * anyExtendedKeyUsage OBJECT IDENTIFIER ::= { id-ce-extKeyUsage 0 }
 * ```
 */
export declare const anyExtendedKeyUsage = "2.5.29.37.0";
/**
 * ```asn1
 * id-kp-serverAuth             OBJECT IDENTIFIER ::= { id-kp 1 }
 * -- TLS WWW server authentication
 * -- Key usage bits that may be consistent: digitalSignature,
 * -- keyEncipherment or keyAgreement
 * ```
 */
export declare const id_kp_serverAuth = "1.3.6.1.5.5.7.3.1";
/**
 * ```asn1
 * id-kp-clientAuth             OBJECT IDENTIFIER ::= { id-kp 2 }
 * -- TLS WWW client authentication
 * -- Key usage bits that may be consistent: digitalSignature
 * -- and/or keyAgreement
 * ```
 */
export declare const id_kp_clientAuth = "1.3.6.1.5.5.7.3.2";
/**
 * ```asn1
 * id-kp-codeSigning             OBJECT IDENTIFIER ::= { id-kp 3 }
 * -- Signing of downloadable executable code
 * -- Key usage bits that may be consistent: digitalSignature
 * ```
 */
export declare const id_kp_codeSigning = "1.3.6.1.5.5.7.3.3";
/**
 * ```asn1
 * id-kp-emailProtection         OBJECT IDENTIFIER ::= { id-kp 4 }
 * -- Email protection
 * -- Key usage bits that may be consistent: digitalSignature,
 * -- nonRepudiation, and/or (keyEncipherment or keyAgreement)
 * ```
 */
export declare const id_kp_emailProtection = "1.3.6.1.5.5.7.3.4";
/**
 * ```asn1
 * id-kp-timeStamping            OBJECT IDENTIFIER ::= { id-kp 8 }
 * -- Binding the hash of an object to a time
 * -- Key usage bits that may be consistent: digitalSignature
 * -- and/or nonRepudiation
 * ```
 */
export declare const id_kp_timeStamping = "1.3.6.1.5.5.7.3.8";
/**
 * ```asn1
 * id-kp-OCSPSigning            OBJECT IDENTIFIER ::= { id-kp 9 }
 * -- Signing OCSP responses
 * -- Key usage bits that may be consistent: digitalSignature
 * -- and/or nonRepudiation
 * ```
 */
export declare const id_kp_OCSPSigning = "1.3.6.1.5.5.7.3.9";
