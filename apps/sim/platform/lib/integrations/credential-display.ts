import type { IntegrationCredential } from '@/platform/lib/integrations/credential-model'

/** Directory visibility follows explicit grants without changing the owning scope. */
export function credentialSharing(credential: IntegrationCredential): 'personal' | 'shared' {
  if (credential.scope.kind === 'personal') return 'personal'
  if (credential.scope.kind !== 'organization') return 'shared'
  return credential.members.filter((member) => member.status !== 'revoked').length > 1
    ? 'shared'
    : 'personal'
}

/** A credential without a description remains identifiable by its stable ID. */
export function credentialDescription(credential: { id: string; description?: string }) {
  return credential.description?.trim() || credential.id
}
