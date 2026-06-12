let cache: { exact: Set<string>; wildcards: string[] } | undefined

/**
 * Lazily loads the `disposable-email-domains` dataset (~120K exact domains plus
 * wildcard base domains) on first use and memoizes it. Deferred behind a dynamic
 * import so deployments with signup email validation disabled never load it.
 */
async function loadDisposableData(): Promise<{ exact: Set<string>; wildcards: string[] }> {
  if (!cache) {
    const [{ default: exactList }, { default: wildcards }] = await Promise.all([
      import('disposable-email-domains'),
      import('disposable-email-domains/wildcard.json'),
    ])
    cache = { exact: new Set(exactList), wildcards }
  }
  return cache
}

/**
 * Server-only disposable-email-domain check. Layered alongside better-auth-harmony's
 * bundled Mailchecker list at the signup gate. Matches exact domains and any subdomain
 * of (or the bare) wildcard base domain.
 *
 * Never import from client code — the dataset would bloat the browser bundle.
 */
export async function isDisposableEmailDomain(email: string): Promise<boolean> {
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) return false
  const { exact, wildcards } = await loadDisposableData()
  if (exact.has(domain)) return true
  return wildcards.some((base) => domain === base || domain.endsWith(`.${base}`))
}
