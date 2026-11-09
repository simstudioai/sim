import { organization } from '@sim/db/schema'
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { DbOrTx } from '@/lib/db/types'

/**
 * The organization that pays for whatever `organizationId` scopes, or NULL when its owner pays
 * personally. A personal organization bills nothing itself: its workspaces and projects bill their
 * billed account and owner exactly as organization-less ones did, so every payer derivation reads
 * this instead of the raw organization id.
 */
export function payerOrganizationIdSql(organizationId: AnyPgColumn | SQL): SQL<string | null> {
  return sql<
    string | null
  >`(SELECT ${organization.id} FROM ${organization} WHERE ${organization.id} = ${organizationId} AND ${organization.kind} = 'team')`
}

/** Which of `organizationIds` pay for their own resources (team organizations). */
export async function selectPayerOrganizationIds(
  executor: DbOrTx,
  organizationIds: Array<string | null>
): Promise<Set<string>> {
  const ids = [...new Set(organizationIds.filter((id): id is string => id !== null))]
  if (ids.length === 0) return new Set()
  const rows = await executor
    .select({ id: organization.id })
    .from(organization)
    .where(and(inArray(organization.id, ids), eq(organization.kind, 'team')))
  return new Set(rows.map((row) => row.id))
}

/** The payer organization for one organization id, or null when its owner pays personally. */
export async function resolvePayerOrganizationId(
  executor: DbOrTx,
  organizationId: string | null
): Promise<string | null> {
  if (!organizationId) return null
  const payers = await selectPayerOrganizationIds(executor, [organizationId])
  return payers.has(organizationId) ? organizationId : null
}
