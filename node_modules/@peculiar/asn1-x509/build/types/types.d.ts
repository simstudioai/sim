/**
 * ```asn1
 * Version  ::=  INTEGER  {  v1(0), v2(1), v3(2)  }
 * ```
 */
export declare enum Version {
    v1 = 0,
    v2 = 1,
    v3 = 2
}
/**
 * ```asn1
 * CertificateSerialNumber  ::=  INTEGER
 * ```
 */
export type CertificateSerialNumber = ArrayBuffer;
/**
 * ```asn1
 * UniqueIdentifier  ::=  BIT STRING
 * ```
 */
export type UniqueIdentifier = ArrayBuffer;
