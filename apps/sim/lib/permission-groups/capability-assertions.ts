import {
  CAPABILITY_RULES,
  refuseCapability,
  type StaticPermissionGroupCapability,
} from '@/lib/permission-groups/capabilities'
import { resolvePermissionGroupConfig } from '@/lib/permission-groups/config-scope.server'
import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'
import { getUserPermissionConfigForOrganization } from '@/ee/access-control/utils/permission-check'

/**
 * Re-exported so a caller that gates inline reaches the refusal sentence and the
 * assertions through one module; {@link CAPABILITY_RULES} remains its only
 * definition.
 */
export { capabilityRefusal } from '@/lib/permission-groups/capabilities'

/**
 * The one way to ask whether a permission group withholds a capability.
 *
 * The authorization funnel decides from the operation alone, which is right when
 * the capability describes the whole operation. Three cases fall outside it: a
 * decision that depends on request input (one download is a single file, the
 * next a folder tree), a raw route that predates the operation boundary, and an
 * organization-level action with no workspace. All of them come through here, so
 * the decision always reads {@link CAPABILITY_RULES} rather than a config key
 * spelled out at a call site — where a renamed key would silently stop denying
 * anything, and the refusal wording would drift from the funnel's.
 */
export function capabilityDeniedBy(
  capability: StaticPermissionGroupCapability,
  config: PermissionGroupConfig | null
): boolean {
  if (!config) return false
  const rule = CAPABILITY_RULES[capability]
  return rule.kind === 'static' && rule.deniedBy(config)
}

/**
 * Throws when `userId`'s group in `workspaceId` withholds `capability`.
 *
 * A no-op when no group governs the user, so a personal workspace or a
 * non-enterprise organization is unaffected. Pass `organizationId` when the
 * caller has already loaded the workspace; omitting it costs one lookup, and
 * both forms share the same per-request memo either way.
 */
export async function assertWorkspaceCapability(
  userId: string,
  workspaceId: string,
  capability: StaticPermissionGroupCapability,
  organizationId?: string | null
): Promise<void> {
  const config = await resolvePermissionGroupConfig(userId, workspaceId, organizationId)
  if (capabilityDeniedBy(capability, config)) refuseCapability(capability)
}

/**
 * Whether the capability is withheld, without throwing.
 *
 * For a caller that must answer rather than refuse — a raw handler rendering its
 * own response shape, or a policy that reports a structured decision.
 */
export async function isWorkspaceCapabilityWithheld(
  userId: string,
  workspaceId: string,
  capability: StaticPermissionGroupCapability,
  organizationId?: string | null
): Promise<boolean> {
  return capabilityDeniedBy(
    capability,
    await resolvePermissionGroupConfig(userId, workspaceId, organizationId)
  )
}

/**
 * The organization-scoped counterpart of {@link isWorkspaceCapabilityWithheld}.
 *
 * Outside the per-request memo on purpose. That memo is keyed by user and
 * workspace, and this decision is keyed by organization alone, so sharing it
 * would need a second key vocabulary in the store. No request asks an
 * organization-scoped capability twice — each of the four call sites gates one
 * listing — so the memo would never be hit. Key it if that changes.
 */
export async function isOrganizationCapabilityWithheld(
  organizationId: string,
  capability: StaticPermissionGroupCapability
): Promise<boolean> {
  return capabilityDeniedBy(
    capability,
    await getUserPermissionConfigForOrganization(organizationId)
  )
}
