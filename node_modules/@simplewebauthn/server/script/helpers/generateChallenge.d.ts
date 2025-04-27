/**
 * Generate a suitably random value to be used as an attestation or assertion challenge
 */
export declare function generateChallenge(): Promise<Uint8Array>;
/**
 * Make it possible to stub the return value during testing
 * @ignore Don't include this in docs output
 */
export declare const _generateChallengeInternals: {
    stubThis: (value: Uint8Array) => Uint8Array;
};
//# sourceMappingURL=generateChallenge.d.ts.map