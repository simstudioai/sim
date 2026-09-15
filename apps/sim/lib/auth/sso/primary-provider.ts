/**
 * The settings page's view of which provider signs in each domain; the rule
 * itself lives in `@sim/db/sso-primary-provider`.
 */

interface SignInCandidate {
  providerId: string
  domainKey: string
  domainVerified: boolean
  isNamedPrimary: boolean
}

/**
 * Marks the provider each domain signs in through, for rows already ordered by
 * provider id: the named primary when it is verified, otherwise the first
 * verified provider. Mirrors the ordering sign-in resolution applies in SQL.
 */
export function markSignInProviders<T extends SignInCandidate>(
  providers: T[]
): Array<Omit<T, 'isNamedPrimary'> & { isPrimary: boolean }> {
  const signInProviderByDomain = new Map<string, string>()
  for (const provider of providers) {
    if (!provider.domainVerified) continue
    if (!signInProviderByDomain.has(provider.domainKey) || provider.isNamedPrimary) {
      signInProviderByDomain.set(provider.domainKey, provider.providerId)
    }
  }
  return providers.map(({ isNamedPrimary: _named, ...provider }) => ({
    ...provider,
    isPrimary: signInProviderByDomain.get(provider.domainKey) === provider.providerId,
  }))
}
