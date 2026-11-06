import type { IntegrationCredential } from '@/platform/lib/integrations/credential-model'

/** Directory visibility follows explicit grants without changing the owning scope. */
export function credentialSharing(credential: IntegrationCredential): 'personal' | 'shared' {
  if (credential.scope.kind === 'personal') return 'personal'
  if (credential.scope.kind !== 'organization') return 'shared'
  return credential.members.filter((member) => member.status !== 'revoked').length > 1
    ? 'shared'
    : 'personal'
}

/** Keep a credential's supporting copy distinct from its display name. */
export function credentialDescription(credential: IntegrationCredential, providerName?: string) {
  const name = credential.displayName.trim().toLowerCase()
  const description = [credential.description, credential.accountLabel].find(
    (value) => value?.trim() && value.trim().toLowerCase() !== name
  )
  if (description) return description
  const scope = credentialSharing(credential) === 'personal' ? 'Personal' : 'Shared'
  return providerName ? `${providerName} ${scope.toLowerCase()} credential` : scope
}
