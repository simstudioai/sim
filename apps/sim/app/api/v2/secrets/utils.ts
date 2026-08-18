import type { V2Secret } from '@/lib/api/contracts/v2/secrets'
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
    description: row.type === 'env_workspace' ? row.description : null,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
