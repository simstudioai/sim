import { SpecifiedECDomain } from "./rfc3279";
/**
 * ```asn1
 * ECParameters ::= CHOICE {
 *   namedCurve         OBJECT IDENTIFIER
 *   implicitCurve   NULL
 *   specifiedCurve  SpecifiedECDomain
 * }
 *   -- implicitCurve and specifiedCurve MUST NOT be used in PKIX.
 *   -- Details for SpecifiedECDomain can be found in [X9.62].
 *   -- Any future additions to this CHOICE should be coordinated
 *   -- with ANSI X9.
 * ```
 */
export declare class ECParameters {
    namedCurve?: string;
    implicitCurve?: null;
    specifiedCurve?: SpecifiedECDomain;
    constructor(params?: Partial<ECParameters>);
}
