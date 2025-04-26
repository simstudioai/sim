import { AsnArray } from "@peculiar/asn1-schema";
import { GeneralName } from "../general_name";
/**
 * ```asn1
 * id-ce-nameConstraints OBJECT IDENTIFIER ::=  { id-ce 30 }
 * ```
 */
export declare const id_ce_nameConstraints = "2.5.29.30";
/**
 * ```asn1
 * BaseDistance ::= INTEGER (0..MAX)
 * ```
 */
export type BaseDistance = number;
/**
 * ```asn1
 * GeneralSubtree ::= SEQUENCE {
 *   base                    GeneralName,
 *   minimum         [0]     BaseDistance DEFAULT 0,
 *   maximum         [1]     BaseDistance OPTIONAL }
 * ```
 */
export declare class GeneralSubtree {
    base: GeneralName;
    minimum: BaseDistance;
    maximum?: BaseDistance;
    constructor(params?: Partial<GeneralSubtree>);
}
/**
 * ```asn1
 * GeneralSubtrees ::= SEQUENCE SIZE (1..MAX) OF GeneralSubtree
 * ```
 */
export declare class GeneralSubtrees extends AsnArray<GeneralSubtree> {
    constructor(items?: GeneralSubtree[]);
}
/**
 * ```asn1
 * NameConstraints ::= SEQUENCE {
 *   permittedSubtrees       [0]     GeneralSubtrees OPTIONAL,
 *   excludedSubtrees        [1]     GeneralSubtrees OPTIONAL }
 * ```
 */
export declare class NameConstraints {
    permittedSubtrees?: GeneralSubtrees;
    excludedSubtrees?: GeneralSubtrees;
    constructor(params?: Partial<NameConstraints>);
}
