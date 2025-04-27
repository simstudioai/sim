import { AlgorithmIdentifier } from "@peculiar/asn1-x509";
/**
 * ```asn1
 * RSAES-OAEP-params ::= SEQUENCE {
 *   hashAlgorithm      [0] HashAlgorithm     DEFAULT sha1,
 *   maskGenAlgorithm   [1] MaskGenAlgorithm  DEFAULT mgf1SHA1,
 *   pSourceAlgorithm   [2] PSourceAlgorithm  DEFAULT pSpecifiedEmpty
 * }
 * ```
 */
export declare class RsaEsOaepParams {
    hashAlgorithm: AlgorithmIdentifier;
    maskGenAlgorithm: AlgorithmIdentifier;
    pSourceAlgorithm: AlgorithmIdentifier;
    constructor(params?: Partial<RsaEsOaepParams>);
}
/**
 * ```asn1
 * { OID id-RSAES-OAEP   PARAMETERS RSAES-OAEP-params } |
 * ```
 */
export declare const RSAES_OAEP: AlgorithmIdentifier;
