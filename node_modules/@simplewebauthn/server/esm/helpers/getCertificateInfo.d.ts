import { Certificate } from '@peculiar/asn1-x509';
export type CertificateInfo = {
    issuer: Issuer;
    subject: Subject;
    version: number;
    basicConstraintsCA: boolean;
    notBefore: Date;
    notAfter: Date;
    parsedCertificate: Certificate;
};
type Issuer = {
    C?: string;
    O?: string;
    OU?: string;
    CN?: string;
    combined: string;
};
type Subject = {
    C?: string;
    O?: string;
    OU?: string;
    CN?: string;
    combined: string;
};
/**
 * Extract PEM certificate info
 *
 * @param pemCertificate Result from call to `convertASN1toPEM(x5c[0])`
 */
export declare function getCertificateInfo(leafCertBuffer: Uint8Array): CertificateInfo;
export {};
//# sourceMappingURL=getCertificateInfo.d.ts.map