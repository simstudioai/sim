/**
 * ```asn1
 * Attribute   ::= SEQUENCE {
 *      type             AttributeType,
 *      values    SET OF AttributeValue }
 *         -- at least one value is required
 * ```
 */
export declare class Attribute {
    type: string;
    values: ArrayBuffer[];
    constructor(params?: Partial<Attribute>);
}
