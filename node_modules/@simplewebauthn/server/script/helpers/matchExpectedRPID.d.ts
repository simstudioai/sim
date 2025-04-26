/**
 * Go through each expected RP ID and try to find one that matches. Returns the unhashed RP ID
 * that matched the hash in the response.
 *
 * Raises an `UnexpectedRPIDHash` error if no match is found
 */
export declare function matchExpectedRPID(rpIDHash: Uint8Array, expectedRPIDs: string[]): Promise<string>;
//# sourceMappingURL=matchExpectedRPID.d.ts.map