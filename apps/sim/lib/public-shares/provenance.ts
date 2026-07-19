/**
 * Provenance label for a publicly shared resource (`"{workspace} · Shared by
 * {owner}"`), shared by the page metadata, the OG card, and the in-page view so
 * the three never drift. Returns an empty string when neither is known; callers
 * apply their own fallback.
 */
export function buildProvenance(workspaceName: string | null, ownerName: string | null): string {
  return [workspaceName, ownerName ? `Shared by ${ownerName}` : null].filter(Boolean).join(' · ')
}

/**
 * Short "Shared by {owner}" credit for a public surface's header (shared file /
 * interface / chat), or `undefined` when the owner is unknown so the header can
 * omit the item entirely.
 */
export function buildSharedByLabel(ownerName: string | null): string | undefined {
  return ownerName ? `Shared by ${ownerName}` : undefined
}
