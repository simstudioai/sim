import { Certificate } from '@peculiar/asn1-x509';
/**
 * A method to pull a CRL from a certificate and compare its serial number to the list of revoked
 * certificate serial numbers within the CRL.
 *
 * CRL certificate structure referenced from https://tools.ietf.org/html/rfc5280#page-117
 */
export declare function isCertRevoked(cert: Certificate): Promise<boolean>;
//# sourceMappingURL=isCertRevoked.d.ts.map