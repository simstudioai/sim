import type { IntegrationCredential } from '@/platform/lib/integrations/credential-model'

/** Keep a credential's supporting copy distinct from its display name. */
export function credentialDescription(credential: IntegrationCredential, providerName?: string) {
  const name = credential.displayName.trim().toLowerCase()
  const description = [credential.description, credential.accountLabel].find(
    (value) => value?.trim() && value.trim().toLowerCase() !== name
  )
  if (description) return description
  const scope = credential.scope.kind === 'personal' ? 'Personal' : credential.scope.name
  return providerName ? `${providerName} · ${scope}` : scope
}
