import { AsnArray } from "@peculiar/asn1-schema";
import { CertPolicyId } from "./certificate_policies";
/**
 * ```asn1
 * id-ce-policyMappings OBJECT IDENTIFIER ::=  { id-ce 33 }
 * ```
 */
export declare const id_ce_policyMappings = "2.5.29.33";
/**
 * ```asn1
 * PolicyMapping ::= SEQUENCE {
 *   issuerDomainPolicy      CertPolicyId,
 *   subjectDomainPolicy     CertPolicyId }
 * ```
 */
export declare class PolicyMapping {
    issuerDomainPolicy: CertPolicyId;
    subjectDomainPolicy: CertPolicyId;
    constructor(params?: Partial<PolicyMappings>);
}
/**
 * ```asn1
 * PolicyMappings ::= SEQUENCE SIZE (1..MAX) OF PolicyMapping
 * ```
 */
export declare class PolicyMappings extends AsnArray<PolicyMapping> {
    constructor(items?: PolicyMapping[]);
}
