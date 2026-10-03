import type { Principal } from '@sim/auth/principal'
import { readDashboardAvailability } from '@/lib/dashboards/application/availability'
import { ENTITLEMENTS, type Entitlement } from '@/lib/mothership/generated/protocol'

/** The owner of one chat turn: exactly one of a workspace or an organization. */
export interface EntitlementOwner {
  principal?: Principal
  workspaceId?: string
  organizationId?: string
}

interface WorkspaceOwner {
  principal: Principal
  workspaceId: string
}

interface OrganizationOwner {
  principal?: Principal
  organizationId: string
}

/**
 * Each entitlement declares the chat scopes it exists in. A scope it does not
 * declare is never granted, so a workspace-only capability cannot leak into an
 * organization chat that has no workspace to run it against.
 */
interface EntitlementEvaluator {
  workspace?: (owner: WorkspaceOwner) => Promise<boolean>
  organization?: (owner: OrganizationOwner) => Promise<boolean>
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
 * 2. Here: add an evaluator for each scope it exists in. Every payload site picks it up
 *    through `buildCopilotRequestPayload`.
 * 3. Keep enforcement in Sim. The payload is forgeable, so the operation behind the gated
 *    surface must re-check the same predicate when it runs.
 */
const EVALUATORS: Record<Entitlement, EntitlementEvaluator> = {
  [ENTITLEMENTS.dashboards]: {
    workspace: ({ principal, workspaceId }) =>
      readDashboardAvailability.execute({ principal, input: { workspaceId } }),
  },
}

function evaluate(evaluator: EntitlementEvaluator, owner: EntitlementOwner): Promise<boolean> {
  const { principal, workspaceId, organizationId } = owner
  if (workspaceId && organizationId) {
    throw new Error('Entitlement owner must be a workspace or an organization, not both')
  }
  if (organizationId) {
    return evaluator.organization?.({ principal, organizationId }) ?? Promise.resolve(false)
  }
  if (workspaceId && principal) {
    return evaluator.workspace?.({ principal, workspaceId }) ?? Promise.resolve(false)
  }
  return Promise.resolve(false)
}

/** The entitlements Sim grants a turn's owner, evaluated fresh for every turn. */
export async function computeEntitlements(owner: EntitlementOwner): Promise<Entitlement[]> {
  const names = Object.values(ENTITLEMENTS)
  const granted = await Promise.all(names.map((name) => evaluate(EVALUATORS[name], owner)))
  return names.filter((_, index) => granted[index])
}
