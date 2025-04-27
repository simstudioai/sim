import { OtherPrimeInfos } from "./other_prime_info";
/**
 * ```asn1
 * Version ::= INTEGER { two-prime(0), multi(1) }
 *     (CONSTRAINED BY
 *       {-- version MUST
 *  be multi if otherPrimeInfos present --})
 * ```
 */
export type Version = number;
/**
 * ```asn1
 * RSAPrivateKey ::= SEQUENCE {
 *   version           Version,
 *   modulus           INTEGER,  -- n
 *   publicExponent    INTEGER,  -- e
 *   privateExponent   INTEGER,  -- d
 *   prime1            INTEGER,  -- p
 *   prime2            INTEGER,  -- q
 *   exponent1         INTEGER,  -- d mod (p-1)
 *   exponent2         INTEGER,  -- d mod (q-1)
 *   coefficient       INTEGER,  -- (inverse of q) mod p
 *   otherPrimeInfos   OtherPrimeInfos OPTIONAL
 * }
 * ```
 */
export declare class RSAPrivateKey {
    version: Version;
    modulus: ArrayBuffer;
    publicExponent: ArrayBuffer;
    privateExponent: ArrayBuffer;
    prime1: ArrayBuffer;
    prime2: ArrayBuffer;
    exponent1: ArrayBuffer;
    exponent2: ArrayBuffer;
    coefficient: ArrayBuffer;
    otherPrimeInfos?: OtherPrimeInfos;
    constructor(params?: Partial<RSAPrivateKey>);
}
