/** Issuers compare without trailing slashes, which identity providers add or drop freely. */
export function normalizeIssuer(issuer: string): string {
  return issuer.trim().replace(/\/+$/, '')
}
