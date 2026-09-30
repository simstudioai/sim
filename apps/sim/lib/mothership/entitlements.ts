import type { Principal } from '@sim/auth/principal'
import { readDashboardAvailability } from '@/lib/dashboards/application/availability'
import { isDashboardsEnabled } from '@/lib/dashboards/feature-flag'
import { ENTITLEMENTS, type Entitlement } from '@/lib/mothership/generated/protocol'

/** The owner of one chat turn: exactly one of a workspace or an organization. */
export interface EntitlementOwner {
  principal?: Principal
  workspaceId?: string
  organizationId?: string
}

/**
 * Entitlements are gated capabilities sent to Mothership as the chat payload's
 * `entitlements` list. The worker hides the matching commands, skills and prompt
 * sections when one is absent, so an organization without the feature never hears of it.
 *
 * Adding an entitlement:
 * 1. Worker: add the name to `ENTITLEMENTS` in `packages/contracts/src/protocol.ts`, run
 *    `bun run contracts:sync`, then declare it on the gated surfaces (`entitlement` on a
 *    command spec, `entitlement:` frontmatter on a skill, or an `entitled()` prompt section).
 * 2. Here: add an evaluator. Every payload site picks it up through `buildCopilotRequestPayload`.
 * 3. Keep enforcement in Sim. The payload is forgeable, so the operation behind the gated
 *    surface must re-check the same predicate when it runs.
 */
const EVALUATORS: Record<Entitlement, (owner: EntitlementOwner) => Promise<boolean>> = {
  [ENTITLEMENTS.dashboards]: async ({ principal, workspaceId, organizationId }) => {
    if (organizationId) return isDashboardsEnabled(organizationId)
    if (!workspaceId || !principal) return false
    return readDashboardAvailability.execute({ principal, input: { workspaceId } })
  },
}

/** The entitlements Sim grants a turn's owner, evaluated fresh for every turn. */
export async function computeEntitlements(owner: EntitlementOwner): Promise<Entitlement[]> {
  const names = Object.values(ENTITLEMENTS)
  const granted = await Promise.all(names.map((name) => EVALUATORS[name](owner)))
  return names.filter((_, index) => granted[index])
}
