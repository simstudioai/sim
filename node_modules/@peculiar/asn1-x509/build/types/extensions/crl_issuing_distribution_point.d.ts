import { DistributionPointName, Reason } from "./crl_distribution_points";
/**
 * ```asn1
 * id-ce-issuingDistributionPoint OBJECT IDENTIFIER ::= { id-ce 28 }
 * ```
 */
export declare const id_ce_issuingDistributionPoint = "2.5.29.28";
/**
 * ```asn1
 * IssuingDistributionPoint ::= SEQUENCE {
 *      distributionPoint          [0] DistributionPointName OPTIONAL,
 *      onlyContainsUserCerts      [1] BOOLEAN DEFAULT FALSE,
 *      onlyContainsCACerts        [2] BOOLEAN DEFAULT FALSE,
 *      onlySomeReasons            [3] ReasonFlags OPTIONAL,
 *      indirectCRL                [4] BOOLEAN DEFAULT FALSE,
 *      onlyContainsAttributeCerts [5] BOOLEAN DEFAULT FALSE }
 *
 *      -- at most one of onlyContainsUserCerts, onlyContainsCACerts,
 *      -- and onlyContainsAttributeCerts may be set to TRUE.
 * ```
 */
export declare class IssuingDistributionPoint {
    static readonly ONLY = false;
    distributionPoint?: DistributionPointName;
    onlyContainsUserCerts: boolean;
    onlyContainsCACerts: boolean;
    onlySomeReasons?: Reason;
    indirectCRL: boolean;
    onlyContainsAttributeCerts: boolean;
    constructor(params?: Partial<IssuingDistributionPoint>);
}
