import { AlgorithmIdentifier } from "@peculiar/asn1-x509";
/**
 * ```asn1
 * TrailerField ::= INTEGER { trailerFieldBC(1) }
 * ```
 */
export type TrailerField = number;
/**
 * ```asn1
 * RSASSA-PSS-params ::= SEQUENCE {
 *   hashAlgorithm      [0] HashAlgorithm      DEFAULT sha1,
 *   maskGenAlgorithm   [1] MaskGenAlgorithm   DEFAULT mgf1SHA1,
 *   saltLength         [2] INTEGER            DEFAULT 20,
 *   trailerField       [3] TrailerField       DEFAULT trailerFieldBC
 * }
 * ```
 */
export declare class RsaSaPssParams {
    hashAlgorithm: AlgorithmIdentifier;
    maskGenAlgorithm: AlgorithmIdentifier;
    saltLength: number;
    trailerField: TrailerField;
    constructor(params?: Partial<RsaSaPssParams>);
}
/**
 * ```asn1
 * { OID id-RSASSA-PSS   PARAMETERS RSASSA-PSS-params }
 * ```
 */
export declare const RSASSA_PSS: AlgorithmIdentifier;
