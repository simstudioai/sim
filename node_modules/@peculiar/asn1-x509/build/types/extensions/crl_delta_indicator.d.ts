import { CRLNumber } from "./crl_number";
/**
 * ```asn1
 * id-ce-deltaCRLIndicator OBJECT IDENTIFIER ::= { id-ce 27 }
 * ```
 */
export declare const id_ce_deltaCRLIndicator = "2.5.29.27";
/**
 * ```asn1
 * BaseCRLNumber ::= CRLNumber
 * ```
 */
export declare class BaseCRLNumber extends CRLNumber {
}
