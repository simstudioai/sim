export type ParametersType = ArrayBuffer | null;
/**
 * ```asn1
 * AlgorithmIdentifier  ::=  SEQUENCE  {
 *   algorithm               OBJECT IDENTIFIER,
 *   parameters              ANY DEFINED BY algorithm OPTIONAL  }
 *                              -- contains a value of the type
 *                              -- registered for use with the
 *                              -- algorithm object identifier value
 * ```
 */
export declare class AlgorithmIdentifier {
    algorithm: string;
    parameters?: ParametersType;
    constructor(params?: Partial<Omit<AlgorithmIdentifier, "isEqual">>);
    isEqual(data: unknown): data is this;
}
