/**
 * Traverse an array of PEM certificates and ensure they form a proper chain
 * @param x5cCertsPEM Typically the result of `x5c.map(convertASN1toPEM)`
 * @param trustAnchorsPEM PEM-formatted certs that an attestation statement x5c may chain back to
 */
export declare function validateCertificatePath(x5cCertsPEM: string[], trustAnchorsPEM?: string[]): Promise<boolean>;
//# sourceMappingURL=validateCertificatePath.d.ts.map