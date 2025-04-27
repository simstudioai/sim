import type { Base64URLString } from '../types/index.js';
import type { AlgSign, MetadataStatement } from './mdsTypes.js';
import { type COSEALG, type COSECRV, COSEKTY } from '../helpers/cose.js';
/**
 * Match properties of the authenticator's attestation statement against expected values as
 * registered with the FIDO Alliance Metadata Service
 */
export declare function verifyAttestationWithMetadata({ statement, credentialPublicKey, x5c, attestationStatementAlg, }: {
    statement: MetadataStatement;
    credentialPublicKey: Uint8Array;
    x5c: Uint8Array[] | Base64URLString[];
    attestationStatementAlg?: number;
}): Promise<boolean>;
type COSEInfo = {
    kty: COSEKTY;
    alg: COSEALG;
    crv?: COSECRV;
};
/**
 * Convert ALG_SIGN values to COSE info
 *
 * Values pulled from `ALG_KEY_COSE` definitions in the FIDO Registry of Predefined Values
 *
 * https://fidoalliance.org/specs/common-specs/fido-registry-v2.2-ps-20220523.html#authentication-algorithms
 */
export declare const algSignToCOSEInfoMap: {
    [key in AlgSign]: COSEInfo;
};
export {};
//# sourceMappingURL=verifyAttestationWithMetadata.d.ts.map