import { db } from '@sim/db'
import {
  type ScimConnectionSettings,
  type ScimScope,
  scimConnection,
  scimCredential,
  scimGroup,
  scimUser,
  workspace,
} from '@sim/db/schema'
import { and, count, desc, eq } from 'drizzle-orm'
import type { ScimConnectionView, ScimCredentialView } from '@/lib/api/contracts/organization-scim'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { scimBaseUrl } from '@/ee/scim/lib/base-url'
import { activeCredentialCondition } from '@/ee/scim/lib/repository/credentials'

/** Reads shared by the admin use cases: the connection row and its settings view. */

interface ConnectionRow {
  id: string
  organizationId: string
  status: string
  settings: ScimConnectionSettings
}

/** The organization's connection, or the not-found refusal every admin write shares. */
export async function requireConnection(organizationId: string): Promise<ConnectionRow> {
  const [row] = await db
    .select({
      id: scimConnection.id,
      organizationId: scimConnection.organizationId,
      status: scimConnection.status,
      settings: scimConnection.settings,
    })
    .from(scimConnection)
    .where(eq(scimConnection.organizationId, organizationId))
    .limit(1)
  if (!row) {
    throw new OrchestrationError(
      'not_found',
      'Enable directory provisioning for this organization first'
    )
  }
  return row
}

/** Refuses a workspace id from outside the organization, on every path that grants access to one. */
export async function assertWorkspaceInOrganization(
  organizationId: string,
  workspaceId: string
): Promise<void> {
  const [target] = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(and(eq(workspace.id, workspaceId), eq(workspace.organizationId, organizationId)))
    .limit(1)
  if (!target) {
    throw new OrchestrationError('not_found', 'That workspace does not belong to this organization')
  }
}

export function toCredentialView(row: {
  id: string
  tokenPrefix: string
  scopes: ScimScope[]
  expiresAt: Date | null
  lastUsedAt: Date | null
  createdAt: Date
}): ScimCredentialView {
  return {
    id: row.id,
    tokenPrefix: row.tokenPrefix,
    scopes: row.scopes,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function loadConnectionView(
  organizationId: string
): Promise<ScimConnectionView | null> {
  const [row] = await db
    .select()
    .from(scimConnection)
    .where(eq(scimConnection.organizationId, organizationId))
    .limit(1)
  if (!row) return null

  const [credentials, [users], [groups]] = await Promise.all([
    db
      .select({
        id: scimCredential.id,
        tokenPrefix: scimCredential.tokenPrefix,
        scopes: scimCredential.scopes,
        expiresAt: scimCredential.expiresAt,
        lastUsedAt: scimCredential.lastUsedAt,
        createdAt: scimCredential.createdAt,
      })
      .from(scimCredential)
      .where(activeCredentialCondition(row.id))
      .orderBy(desc(scimCredential.createdAt)),
    db.select({ value: count() }).from(scimUser).where(eq(scimUser.connectionId, row.id)),
    db.select({ value: count() }).from(scimGroup).where(eq(scimGroup.connectionId, row.id)),
  ])

  return {
    id: row.id,
    status: row.status === 'disabled' ? 'disabled' : 'active',
    baseUrl: scimBaseUrl(),
    settings: row.settings,
    lastRequestAt: row.lastRequestAt?.toISOString() ?? null,
    reconciledAt: row.reconciledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    credentials: credentials.map(toCredentialView),
    userCount: users?.value ?? 0,
    groupCount: groups?.value ?? 0,
  }
}
