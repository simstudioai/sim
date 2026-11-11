import { db } from '@sim/db'
import { member, organization } from '@sim/db/schema'
import { ORG_ADMIN_ROLES } from '@sim/platform-authz/workspace'
import { inArray, type SQL, sql } from 'drizzle-orm'
import { isTeamOrganization } from '@/lib/billing/core/payer-organization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'

/**
 * Refuses, with a typed error, configuration a personal organization never holds because it could
 * not follow its owner into the team they join: migration 0458's triggers refuse the same rows for
 * every writer, and this is the refusal a person reads before they would fire.
 */
export async function requireTeamOrganization(
  organizationId: string,
  feature: string,
  executor: DbOrTx = db
): Promise<void> {
  if (await isTeamOrganization(organizationId, executor)) return
  throw new OrchestrationError('forbidden', `Only team organizations can use ${feature}.`)
}

/**
 * Whether a `member` row confers inherited admin over its organization's workspaces, Projects and
 * shared credentials: an owner or admin of a team organization. A personal organization's owner
 * inherits nothing, because another account's fork of their workspace stays in their personal
 * organization and Project and remains that account's own.
 */
export function inheritsOrganizationAdmin(): SQL {
  return sql`(${inArray(member.role, [...ORG_ADMIN_ROLES])} AND EXISTS (
    SELECT 1 FROM ${organization}
    WHERE ${organization.id} = ${member.organizationId} AND ${organization.kind} = 'team'
  ))`
}
