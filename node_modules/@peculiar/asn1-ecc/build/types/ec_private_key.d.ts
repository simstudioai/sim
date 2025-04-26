import { OctetString } from "@peculiar/asn1-schema";
import { ECParameters } from "./ec_parameters";
/**
 * ```asn1
 * ECPrivateKey ::= SEQUENCE {
 *   version        INTEGER { ecPrivkeyVer1(1) } (ecPrivkeyVer1),
 *   privateKey     OCTET STRING,
 *   parameters [0] ECParameters {{ NamedCurve }} OPTIONAL,
 *   publicKey  [1] BIT STRING OPTIONAL
 * }
 * ```
 */
export declare class ECPrivateKey {
    version: number;
    privateKey: OctetString;
    parameters?: ECParameters;
    publicKey?: ArrayBuffer;
    constructor(params?: Partial<ECPrivateKey>);
}
