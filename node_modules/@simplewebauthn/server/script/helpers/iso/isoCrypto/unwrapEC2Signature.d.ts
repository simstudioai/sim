import { COSECRV } from '../../cose.js';
/**
 * In WebAuthn, EC2 signatures are wrapped in ASN.1 structure so we need to peel r and s apart.
 *
 * See https://www.w3.org/TR/webauthn-2/#sctn-signature-attestation-types
 */
export declare function unwrapEC2Signature(signature: Uint8Array, crv: COSECRV): Uint8Array;
//# sourceMappingURL=unwrapEC2Signature.d.ts.map