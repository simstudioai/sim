import { AsnArray, BitString } from "@peculiar/asn1-schema";
import { RelativeDistinguishedName } from "../name";
import { GeneralName } from "../general_name";
/**
 * ```asn1
 * id-ce-cRLDistributionPoints OBJECT IDENTIFIER ::=  { id-ce 31 }
 * ```
 */
export declare const id_ce_cRLDistributionPoints = "2.5.29.31";
export type ReasonType = "unused" | "keyCompromise" | "cACompromise" | "affiliationChanged" | "superseded" | "cessationOfOperation" | "certificateHold" | "privilegeWithdrawn" | "aACompromise";
export declare enum ReasonFlags {
    unused = 1,
    keyCompromise = 2,
    cACompromise = 4,
    affiliationChanged = 8,
    superseded = 16,
    cessationOfOperation = 32,
    certificateHold = 64,
    privilegeWithdrawn = 128,
    aACompromise = 256
}
/**
 * ```asn1
 * ReasonFlags ::= BIT STRING {
 *   unused                  (0),
 *   keyCompromise           (1),
 *   cACompromise            (2),
 *   affiliationChanged      (3),
 *   superseded              (4),
 *   cessationOfOperation    (5),
 *   certificateHold         (6),
 *   privilegeWithdrawn      (7),
 *   aACompromise            (8) }
 * ```
 */
export declare class Reason extends BitString {
    toJSON(): ReasonType[];
    toString(): string;
}
/**
 * ```asn1
 * DistributionPointName ::= CHOICE {
 *   fullName                [0]     GeneralNames,
 *   nameRelativeToCRLIssuer [1]     RelativeDistinguishedName }
 * ```
 */
export declare class DistributionPointName {
    fullName?: GeneralName[];
    nameRelativeToCRLIssuer?: RelativeDistinguishedName;
    constructor(params?: Partial<DistributionPointName>);
}
/**
 * ```asn1
 * DistributionPoint ::= SEQUENCE {
 *   distributionPoint       [0]     DistributionPointName OPTIONAL,
 *   reasons                 [1]     ReasonFlags OPTIONAL,
 *   cRLIssuer               [2]     GeneralNames OPTIONAL }
 * ```
 */
export declare class DistributionPoint {
    distributionPoint?: DistributionPointName;
    reasons?: Reason;
    cRLIssuer?: GeneralName[];
    constructor(params?: Partial<DistributionPoint>);
}
/**
 * ```asn1
 * CRLDistributionPoints ::= SEQUENCE SIZE (1..MAX) OF DistributionPoint
 * ```
 */
export declare class CRLDistributionPoints extends AsnArray<DistributionPoint> {
    constructor(items?: DistributionPoint[]);
}
