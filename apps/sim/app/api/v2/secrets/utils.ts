import type { V2Secret, V2SecretScope } from '@/lib/api/contracts/v2/secrets'
import type { VisibleWorkspaceCredential } from '@/lib/credentials/queries'

/** Serialize environment credential metadata as a secret without exposing its stored value. */
export function toV2Secret(row: VisibleWorkspaceCredential, userId: string): V2Secret {
  if (!row.envKey || (row.type !== 'env_workspace' && row.type !== 'env_personal')) {
    throw new Error(`Credential ${row.id} is not a secret`)
  }
  if (row.type === 'env_personal' && row.envOwnerUserId !== userId) {
    throw new Error(`Personal secret ${row.id} is not owned by the caller`)
  }

  return {
    name: row.envKey,
    scope: row.type === 'env_workspace' ? 'workspace' : 'personal',
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function secretCredentialTypes(scope?: V2SecretScope) {
  if (scope === 'workspace') return ['env_workspace'] as const
  if (scope === 'personal') return ['env_personal'] as const
  return ['env_workspace', 'env_personal'] as const
}
