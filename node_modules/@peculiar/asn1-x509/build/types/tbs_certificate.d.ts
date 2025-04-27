import { AlgorithmIdentifier } from "./algorithm_identifier";
import { Name } from "./name";
import { SubjectPublicKeyInfo } from "./subject_public_key_info";
import { Validity } from "./validity";
import { Extensions } from "./extension";
import { Version, CertificateSerialNumber, UniqueIdentifier } from "./types";
/**
 * ```asn1
 * TBSCertificate  ::=  SEQUENCE  {
 *   version         [0]  Version DEFAULT v1,
 *   serialNumber         CertificateSerialNumber,
 *   signature            AlgorithmIdentifier,
 *   issuer               Name,
 *   validity             Validity,
 *   subject              Name,
 *   subjectPublicKeyInfo SubjectPublicKeyInfo,
 *   issuerUniqueID  [1]  IMPLICIT UniqueIdentifier OPTIONAL,
 *                        -- If present, version MUST be v2 or v3
 *   subjectUniqueID [2]  IMPLICIT UniqueIdentifier OPTIONAL,
 *                        -- If present, version MUST be v2 or v3
 *   extensions      [3]  Extensions OPTIONAL
 *                        -- If present, version MUST be v3 --  }
 * ```
 */
export declare class TBSCertificate {
    version: Version;
    serialNumber: CertificateSerialNumber;
    signature: AlgorithmIdentifier;
    issuer: Name;
    validity: Validity;
    subject: Name;
    subjectPublicKeyInfo: SubjectPublicKeyInfo;
    issuerUniqueID?: UniqueIdentifier;
    subjectUniqueID?: UniqueIdentifier;
    extensions?: Extensions;
    constructor(params?: Partial<TBSCertificate>);
}
