import type { WorkspaceCredential } from '@/lib/api/contracts/credentials'
import type { OrganizationCredential } from '@/lib/api/contracts/organization-credentials'
import type { V2Credential } from '@/lib/api/contracts/v2/credentials'
import {
  type CredentialActorContext,
  requireOrdinaryCredentialType,
} from '@/lib/credentials/access'
import type { CredentialRow, VisibleWorkspaceCredential } from '@/lib/credentials/queries'

type PublicCredentialSource =
  | VisibleWorkspaceCredential
  | (CredentialRow & { hasServiceAccountKey: boolean; role: 'admin' | 'member' })

/** Serializes connection metadata field by field so encrypted columns can never reach the wire. */
export function toV2Credential(row: PublicCredentialSource): V2Credential {
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

/** Serializes credential metadata for the internal workspace surface. */
export function toWorkspaceCredential(
  row: CredentialRow | VisibleWorkspaceCredential,
  access?: CredentialActorContext
): WorkspaceCredential {
  if (!row.workspaceId)
    throw new Error('Workspace credential presentation requires workspace ownership')
  const type = requireOrdinaryCredentialType(row.type)
  if (!row.createdBy) throw new Error(`Credential ${row.id} has no creator`)
  const role = access?.isAdmin
    ? 'admin'
    : (access?.member?.role ?? ('role' in row ? row.role : undefined))
  const status = access?.member?.status ?? (access?.isAdmin ? 'active' : undefined)
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    type,
    displayName: row.displayName,
    description: row.description,
    unredacted: row.unredacted,
    providerId: row.providerId,
    accountId: row.accountId,
    envKey: row.envKey,
    envOwnerUserId: row.envOwnerUserId,
    ...(row.type === 'personal_token' && row.providerTenantId
      ? { instanceUrl: row.providerTenantId }
      : {}),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(role ? { role } : {}),
    ...(status ? { status } : {}),
  }
}

/** Projects only public metadata from an organization-owned connection. */
export function toOrganizationCredential(row: CredentialRow): OrganizationCredential {
  if (
    !row.organizationId ||
    row.workspaceId ||
    (row.type !== 'oauth' && row.type !== 'service_account') ||
    !row.createdBy
  ) {
    throw new Error('Organization credential presentation requires an organization connection')
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    workspaceId: null,
    type: row.type,
    displayName: row.displayName,
    description: row.description,
    unredacted: false,
    providerId: row.providerId,
    accountId: row.accountId,
    envKey: null,
    envOwnerUserId: null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    role: 'admin',
    status: 'active',
  }
}
