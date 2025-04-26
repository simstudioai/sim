import { AuthenticationExtensionsAuthenticatorOutputs } from './decodeAuthenticatorExtensions.js';
/**
 * Make sense of the authData buffer contained in an Attestation
 */
export declare function parseAuthenticatorData(authData: Uint8Array): ParsedAuthenticatorData;
export type ParsedAuthenticatorData = {
    rpIdHash: Uint8Array;
    flagsBuf: Uint8Array;
    flags: {
        up: boolean;
        uv: boolean;
        be: boolean;
        bs: boolean;
        at: boolean;
        ed: boolean;
        flagsInt: number;
    };
    counter: number;
    counterBuf: Uint8Array;
    aaguid?: Uint8Array;
    credentialID?: Uint8Array;
    credentialPublicKey?: Uint8Array;
    extensionsData?: AuthenticationExtensionsAuthenticatorOutputs;
    extensionsDataBuffer?: Uint8Array;
};
/**
 * Make it possible to stub the return value during testing
 * @ignore Don't include this in docs output
 */
export declare const _parseAuthenticatorDataInternals: {
    stubThis: (value: ParsedAuthenticatorData) => ParsedAuthenticatorData;
};
//# sourceMappingURL=parseAuthenticatorData.d.ts.map