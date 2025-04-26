import type { Base64URLString } from '../types/index.js';
/**
 * Decode an authenticator's base64url-encoded clientDataJSON to JSON
 */
export declare function decodeClientDataJSON(data: Base64URLString): ClientDataJSON;
export type ClientDataJSON = {
    type: string;
    challenge: string;
    origin: string;
    crossOrigin?: boolean;
    tokenBinding?: {
        id?: string;
        status: 'present' | 'supported' | 'not-supported';
    };
};
/**
 * Make it possible to stub the return value during testing
 * @ignore Don't include this in docs output
 */
export declare const _decodeClientDataJSONInternals: {
    stubThis: (value: ClientDataJSON) => ClientDataJSON;
};
//# sourceMappingURL=decodeClientDataJSON.d.ts.map