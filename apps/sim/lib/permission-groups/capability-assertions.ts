import { PermissionGroupCapabilityError } from '@/lib/core/application/workspace-authorization'
import {
  CAPABILITY_RULES,
  capabilityRefusalMessage,
  type StaticPermissionGroupCapability,
} from '@/lib/permission-groups/capabilities'
import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'
import { getUserPermissionConfig } from '@/ee/access-control/utils/permission-check'

/**
 * The capability gate for callers the authorization funnel cannot serve.
 *
 * The funnel decides from the operation alone, which is right for a capability
 * that describes the whole operation. Two cases fall outside it: a request whose
 * capability depends on its own input — one download is a single file, the next
 * is a folder tree — and a raw route that predates the operation boundary. Both
 * assert here so the decision still comes from {@link CAPABILITY_RULES} rather
 * than from a config key spelled out at the call site, where a renamed key would
 * silently stop denying anything.
 */
export function capabilityDeniedBy(
  capability: StaticPermissionGroupCapability,
  config: PermissionGroupConfig | null
): boolean {
  if (!config) return false
  const rule = CAPABILITY_RULES[capability]
  return rule.kind === 'static' && rule.deniedBy(config)
}

/** The refusal a caller sees, identical to the funnel's for the same capability. */
export function capabilityRefusal(capability: StaticPermissionGroupCapability): string {
  return capabilityRefusalMessage(CAPABILITY_RULES[capability].describe)
}

/**
 * Throws {@link PermissionGroupCapabilityError} when `userId`'s group in
 * `workspaceId` withholds `capability`. A no-op when no group governs the user,
 * so workspaces outside an enterprise organization are unaffected.
 */
export async function assertWorkspaceCapability(
  userId: string,
  workspaceId: string,
  capability: StaticPermissionGroupCapability
): Promise<void> {
  const config = await getUserPermissionConfig(userId, workspaceId)
  if (!capabilityDeniedBy(capability, config)) return
  const rule = CAPABILITY_RULES[capability]
  throw new PermissionGroupCapabilityError(capability, rule.detailCode, rule.describe)
}
