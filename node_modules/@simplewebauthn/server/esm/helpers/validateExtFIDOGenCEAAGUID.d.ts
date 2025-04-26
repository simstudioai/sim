import { Extensions } from '@peculiar/asn1-x509';
/**
 * Look for the id-fido-gen-ce-aaguid certificate extension. If it's present then check it against
 * the attestation statement AAGUID.
 */
export declare function validateExtFIDOGenCEAAGUID(certExtensions: Extensions | undefined, aaguid: Uint8Array): boolean;
//# sourceMappingURL=validateExtFIDOGenCEAAGUID.d.ts.map