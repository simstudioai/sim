import { AlgorithmIdentifier } from "@peculiar/asn1-x509";
import { OctetString } from "@peculiar/asn1-schema";
/**
 * ```asn1
 * DigestInfo ::= SEQUENCE {
 *   digestAlgorithm DigestAlgorithm,
 *   digest OCTET STRING
 * }
 * ```
 */
export declare class DigestInfo {
    digestAlgorithm: AlgorithmIdentifier;
    digest: OctetString;
    constructor(params?: Partial<DigestInfo>);
}
