import type { V2Credential } from '@/lib/api/contracts/v2/credentials'
import type { VisibleWorkspaceCredential } from '@/lib/credentials/queries'

/** Serialize connection metadata field by field so encrypted columns can never reach the wire. */
export function toV2Credential(row: VisibleWorkspaceCredential): V2Credential {
  if (row.type !== 'oauth' && row.type !== 'service_account') {
    throw new Error(`Secret credential type ${row.type} reached the credentials API`)
  }

  return {
    id: row.id,
    type: row.type,
    displayName: row.displayName,
    description: row.description,
    providerId: row.providerId,
    accountId: row.accountId,
    hasServiceAccountKey: row.hasServiceAccountKey,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
