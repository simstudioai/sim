/**
 * Provenance label for a shared file (`"{workspace} · Shared by {owner}"`), shared
 * by the page metadata, the OG card, and the in-page viewer so the three never
 * drift. Returns an empty string when neither is known; callers apply their own
 * fallback.
 */
export function buildProvenance(workspaceName: string | null, ownerName: string | null): string {
  return [workspaceName, ownerName ? `Shared by ${ownerName}` : null].filter(Boolean).join(' · ')
}
