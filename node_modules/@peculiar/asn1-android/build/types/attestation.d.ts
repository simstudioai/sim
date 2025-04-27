import { OctetString } from "@peculiar/asn1-schema";
/**
 * Implements ASN.1 structure for attestation package info.
 *
 * ```asn
 * AttestationPackageInfo ::= SEQUENCE {
 *   package_name  OCTET_STRING,
 *   version       INTEGER,
 * }
 * ```
 */
export declare class AttestationPackageInfo {
    packageName: OctetString;
    version: number;
    constructor(params?: Partial<AttestationPackageInfo>);
}
/**
 * Implements ASN.1 structure for attestation application id.
 *
 * ```asn
 * AttestationApplicationId ::= SEQUENCE {
 *   package_infos      SET OF AttestationPackageInfo,
 *   signature_digests  SET OF OCTET_STRING,
 * }
 * ```
 */
export declare class AttestationApplicationId {
    packageInfos: AttestationPackageInfo[];
    signatureDigests: OctetString[];
    constructor(params?: Partial<AttestationApplicationId>);
}
