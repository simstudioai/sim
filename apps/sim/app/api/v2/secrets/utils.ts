import type { V2SecretWithValue } from '@/lib/api/contracts/v2/secrets'
import type { VisibleWorkspaceCredential } from '@/lib/credentials/queries'

/**
 * Serialize environment credential metadata as a secret. The stored value is
 * attached only when supplied AND the row is a workspace secret marked visible
 * (unredacted) — the guard here, not only at the caller, so no code path can
 * hand a value to a row whose flag does not disclose it.
 */
export function toV2Secret(
  row: VisibleWorkspaceCredential,
  userId: string,
  value?: string
): V2SecretWithValue {
  if (!row.envKey || (row.type !== 'env_workspace' && row.type !== 'env_personal')) {
    throw new Error(`Credential ${row.id} is not a secret`)
  }
  if (row.type === 'env_personal' && row.envOwnerUserId !== userId) {
    throw new Error(`Personal secret ${row.id} is not owned by the caller`)
  }

  const unredacted = row.type === 'env_workspace' ? row.unredacted : false
  return {
    name: row.envKey,
    scope: row.type === 'env_workspace' ? 'workspace' : 'personal',
    description: row.type === 'env_workspace' ? row.description : null,
    unredacted,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(value !== undefined && unredacted ? { value } : {}),
  }
}
