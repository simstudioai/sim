import { AlgorithmIdentifier } from "./algorithm_identifier";
import { TBSCertList } from "./tbs_cert_list";
/**
 * ```asn1
 * CertificateList  ::=  SEQUENCE  {
 *   tbsCertList          TBSCertList,
 *   signatureAlgorithm   AlgorithmIdentifier,
 *   signature            BIT STRING  }
 * ```
 */
export declare class CertificateList {
    tbsCertList: TBSCertList;
    signatureAlgorithm: AlgorithmIdentifier;
    signature: ArrayBuffer;
    constructor(params?: Partial<CertificateList>);
}
