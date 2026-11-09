import { db } from '@sim/db'
import { isTeamOrganization } from '@/lib/billing/core/payer-organization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'

/**
 * Refuses, with a typed error, configuration a personal organization never holds because it could
 * not follow its owner into the team they join: migration 0457's triggers refuse the same rows for
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
