/**
 * ```asn1
 * id-ce-cRLReasons OBJECT IDENTIFIER ::= { id-ce 21 }
 * ```
 */
export declare const id_ce_cRLReasons = "2.5.29.21";
export declare enum CRLReasons {
    unspecified = 0,
    keyCompromise = 1,
    cACompromise = 2,
    affiliationChanged = 3,
    superseded = 4,
    cessationOfOperation = 5,
    certificateHold = 6,
    removeFromCRL = 8,
    privilegeWithdrawn = 9,
    aACompromise = 10
}
/**
 * ```asn1
 * CRLReason ::= ENUMERATED {
 *   unspecified             (0),
 *   keyCompromise           (1),
 *   cACompromise            (2),
 *   affiliationChanged      (3),
 *   superseded              (4),
 *   cessationOfOperation    (5),
 *   certificateHold         (6),
 *        -- value 7 is not used
 *   removeFromCRL           (8),
 *   privilegeWithdrawn      (9),
 *   aACompromise           (10) }
 * ```
 */
export declare class CRLReason {
    reason: CRLReasons;
    constructor(reason?: CRLReasons);
    toJSON(): string;
    toString(): string;
}
