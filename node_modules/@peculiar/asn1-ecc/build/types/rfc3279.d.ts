import { OctetString } from "@peculiar/asn1-schema";
/**
 * ```asn1
 *  FieldID ::= SEQUENCE {
 *    fieldType   OBJECT IDENTIFIER,
 *    parameters  ANY DEFINED BY fieldType }
 * ```
 */
export declare class FieldID {
    fieldType: string;
    parameters: ArrayBuffer;
    constructor(params?: Partial<FieldID>);
}
/**
 * ```asn1
 *  ECPoint ::= OCTET STRING
 * ```
 */
export declare class ECPoint extends OctetString {
}
/**
 * ```asn1
 *  FieldElement ::= OCTET STRING
 * ```
 */
export declare class FieldElement extends OctetString {
}
/**
 * ```asn1
 *  Curve ::= SEQUENCE {
 *    a         FieldElement,
 *    b         FieldElement,
 *    seed      BIT STRING OPTIONAL }
 * ```
 */
export declare class Curve {
    a: ArrayBuffer;
    b: ArrayBuffer;
    seed?: ArrayBuffer;
    constructor(params?: Partial<Curve>);
}
/**
 * ```asn1
 *  ECPVer ::= INTEGER {ecpVer1(1)}
 * ```
 */
export declare enum ECPVer {
    ecpVer1 = 1
}
/**
 * ```asn1
 * SpecifiedECDomain ::= SEQUENCE {
 *   version   ECPVer,          -- version is always 1
 *   fieldID   FieldID,         -- identifies the finite field over
 *                              -- which the curve is defined
 *   curve     Curve,           -- coefficients a and b of the
 *                              -- elliptic curve
 *   base      ECPoint,         -- specifies the base point P
 *                              -- on the elliptic curve
 *   order     INTEGER,         -- the order n of the base point
 *   cofactor  INTEGER OPTIONAL -- The integer h = #E(Fq)/n
 *   }
 * ```
 */
export declare class SpecifiedECDomain {
    version: ECPVer;
    fieldID: FieldID;
    curve: Curve;
    base: ECPoint;
    order: ArrayBuffer;
    cofactor?: ArrayBuffer;
    constructor(params?: Partial<SpecifiedECDomain>);
}
