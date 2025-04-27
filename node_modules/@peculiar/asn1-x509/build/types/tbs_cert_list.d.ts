import { AlgorithmIdentifier } from "./algorithm_identifier";
import { Name } from "./name";
import { Time } from "./time";
import { Extension } from "./extension";
import { Version } from "./types";
/**
 * Revoked certificate
 * ```asn1
 * SEQUENCE  {
 *   userCertificate         CertificateSerialNumber,
 *   revocationDate          Time,
 *   crlEntryExtensions      Extensions OPTIONAL
 *                            -- if present, version MUST be v2
 * }
 * ```
 */
export declare class RevokedCertificate {
    /**
     * Serial number of the certificate
     */
    userCertificate: ArrayBuffer;
    /**
     * Revocation date
     */
    revocationDate: Time;
    crlEntryExtensions?: Extension[];
    constructor(params?: Partial<RevokedCertificate>);
}
/**
 * ```asn1
 * TBSCertList  ::=  SEQUENCE  {
 *   version                 Version OPTIONAL,
 *                                 -- if present, MUST be v2
 *   signature               AlgorithmIdentifier,
 *   issuer                  Name,
 *   thisUpdate              Time,
 *   nextUpdate              Time OPTIONAL,
 *   revokedCertificates     SEQUENCE OF SEQUENCE  {
 *        userCertificate         CertificateSerialNumber,
 *        revocationDate          Time,
 *        crlEntryExtensions      Extensions OPTIONAL
 *                                 -- if present, version MUST be v2
 *                             }  OPTIONAL,
 *   crlExtensions           [0] Extensions OPTIONAL }
 *                                 -- if present, version MUST be v2
 * ```
 */
export declare class TBSCertList {
    version?: Version;
    signature: AlgorithmIdentifier;
    issuer: Name;
    thisUpdate: Time;
    nextUpdate?: Time;
    revokedCertificates?: RevokedCertificate[];
    crlExtensions?: Extension[];
    constructor(params?: Partial<TBSCertList>);
}
