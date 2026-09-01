export type SecretMountScope = 'all' | 'selected'

export interface SecretMountPolicy {
  secretScope: SecretMountScope
  mountedSecrets: string[]
}

export const MAX_SECRET_MOUNT_NAMES = 100
export const MAX_SECRET_MOUNT_NAME_LENGTH = 1024

export const DEFAULT_SECRET_MOUNT_POLICY: SecretMountPolicy = {
  secretScope: 'all',
  mountedSecrets: [],
}

interface SecretMountPolicyInput {
  secretScope?: unknown
  mountedSecrets?: unknown
}

function normalizeSecretNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const names = new Set<string>()
  for (const candidate of value) {
    if (typeof candidate !== 'string') continue
    const name = candidate.trim()
    if (name) names.add(name)
  }
  return [...names]
}

/**
 * Normalizes persisted or legacy policy data. A missing scope uses the backwards-compatible
 * `all` policy; an explicit invalid scope fails closed. Selected policies keep a canonical,
 * de-duplicated names-only allowlist.
 */
export function normalizeSecretMountPolicy(
  input?: SecretMountPolicyInput | null
): SecretMountPolicy {
  if (input?.secretScope === undefined || input.secretScope === 'all') {
    return { ...DEFAULT_SECRET_MOUNT_POLICY }
  }

  if (input.secretScope !== 'selected') {
    return { secretScope: 'selected', mountedSecrets: [] }
  }

  return {
    secretScope: 'selected',
    mountedSecrets: normalizeSecretNames(input.mountedSecrets),
  }
}

/**
 * Applies a normalized headless allowlist to explicitly referenced secret
 * names. A selected policy denies the whole request when any reference is not
 * listed so code never runs with a surprising partial environment.
 */
export function applySecretMountPolicy(
  requestedNames: readonly string[],
  input?: SecretMountPolicyInput | null
): string[] {
  const policy = normalizeSecretMountPolicy(input)
  const requested = normalizeSecretNames(requestedNames)
  if (policy.secretScope === 'all') return requested

  const allowed = new Set(policy.mountedSecrets)
  const denied = requested.filter((name) => !allowed.has(name))
  if (denied.length > 0) {
    throw new Error(`Secret access is not allowed for: ${denied.join(', ')}`)
  }

  return requested
}

/**
 * Filters secret-name discovery surfaces to the names visible under a mount policy.
 * Unlike {@link applySecretMountPolicy}, this does not reject inaccessible names because
 * inventory generation starts from the complete workspace catalog.
 */
export function filterSecretNamesByMountPolicy(
  availableNames: readonly string[],
  input?: SecretMountPolicyInput | null
): string[] {
  const policy = normalizeSecretMountPolicy(input)
  const available = normalizeSecretNames(availableNames)
  if (policy.secretScope === 'all') return available

  const allowed = new Set(policy.mountedSecrets)
  return available.filter((name) => allowed.has(name))
}
