import { AlgorithmIdentifier } from "./algorithm_identifier";
import { TBSCertificate } from "./tbs_certificate";
/**
 * ```asn1
 * Certificate  ::=  SEQUENCE  {
 *   tbsCertificate       TBSCertificate,
 *   signatureAlgorithm   AlgorithmIdentifier,
 *   signatureValue       BIT STRING  }
 * ```
 */
export declare class Certificate {
    tbsCertificate: TBSCertificate;
    signatureAlgorithm: AlgorithmIdentifier;
    signatureValue: ArrayBuffer;
    constructor(params?: Partial<Certificate>);
}
