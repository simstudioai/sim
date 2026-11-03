import type { IntegrationAvailabilityResponse } from '@/lib/api/contracts/common'
import type { BlockVisibilityState } from '@/lib/core/config/block-visibility'
import {
  isDeploymentGatedIntegrationType,
  resolveIntegrationAvailabilityStateForVisibility,
} from '@/lib/integrations/availability'
import { isBlockTypeAccessControlExempt } from '@/lib/permission-groups/block-access'
import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'
import {
  intersectAccessControlAllowlists,
  resolveAccessControlBlockType,
  toAccessControlAllowlist,
} from '@/lib/permission-groups/integration-allowlist'
import {
  createAccessRequestCatalog,
  getPermissionGroupAccessState,
} from '@/ee/access-requests/lib/targets'

/**
 * What a viewer can do with an integration in one workspace — the single
 * answer every surface that lists integrations renders from.
 *
 * - `available`: usable.
 * - `unconfigured`: the policy permits it, but this deployment has not
 *   configured its OAuth client. The catalog shows it as unavailable; pickers
 *   leave it out, since the server drops a mention of it.
 * - `requestable`: the permission group restricts it within what the deployment
 *   allows, so an access request can lift the restriction.
 * - `denied`: restricted with no request path.
 */
export type IntegrationAccess = 'available' | 'unconfigured' | 'requestable' | 'denied'

/**
 * Whether a picker or `@` menu may offer an integration: usable now. No verdict
 * yet (`undefined`) is never usable, so a listing fails closed while loading.
 */
export function isIntegrationUsable(access: IntegrationAccess | undefined): boolean {
  return access === 'available'
}

/** Whether the policy permits an integration, whether or not the deployment configured it. */
export function isIntegrationPermitted(access: IntegrationAccess | undefined): boolean {
  return access === 'available' || access === 'unconfigured'
}

/** The inputs one access decision reads, in the resolved allowlist vocabulary. */
export interface IntegrationAccessPolicy {
  /** The permission group intersected with the deployment allowlist; `null` is unrestricted. */
  allowlist: ReadonlySet<string> | null
  /** The deployment allowlist alone: the ceiling an access request can lift a restriction to. */
  deploymentAllowlist: ReadonlySet<string> | null
  /** Deployment availability by lowercased block type, projected through the viewer's visibility. */
  availability: ReadonlyMap<string, IntegrationAvailabilityResponse>
  credentialGroupsEnabled: boolean
  groupConfig?: PermissionGroupConfig | null
}

interface IntegrationAccessPolicyInput {
  groupAllowlist: readonly string[] | null
  deploymentAllowlist: readonly string[] | null
  availability: readonly IntegrationAvailabilityResponse[]
  visibility: BlockVisibilityState | null
  credentialGroupsEnabled: boolean
  groupConfig?: PermissionGroupConfig | null
}

export function createIntegrationAccessPolicy({
  groupAllowlist,
  deploymentAllowlist,
  availability,
  visibility,
  credentialGroupsEnabled,
  groupConfig,
}: IntegrationAccessPolicyInput): IntegrationAccessPolicy {
  return {
    allowlist: intersectAccessControlAllowlists(groupAllowlist, deploymentAllowlist),
    deploymentAllowlist: toAccessControlAllowlist(deploymentAllowlist),
    availability: new Map(
      availability.map((entry) => [
        entry.type.toLowerCase(),
        { ...entry, state: resolveIntegrationAvailabilityStateForVisibility(entry, visibility) },
      ])
    ),
    credentialGroupsEnabled,
    groupConfig,
  }
}

const INTEGRATION_REQUEST_CATALOG = createAccessRequestCatalog({
  integrations: [],
  providers: [],
  models: [],
  tools: [],
  knowledgeConnectors: [],
})

/**
 * The policy is judged before deployment configuration, so an integration the
 * permission group restricts is never advertised as merely unconfigured.
 */
export function resolveIntegrationAccess(
  blockType: string,
  policy: IntegrationAccessPolicy
): IntegrationAccess {
  const normalizedBlockType = blockType.toLowerCase()
  if (normalizedBlockType === 'credential_group' && !policy.credentialGroupsEnabled) {
    return 'denied'
  }
  const state = policy.availability.get(normalizedBlockType)?.state
  const unconfigured =
    isDeploymentGatedIntegrationType(normalizedBlockType) &&
    (state === 'unavailable' || state === 'misconfigured')

  const groupState =
    policy.groupConfig && !isBlockTypeAccessControlExempt(normalizedBlockType)
      ? getPermissionGroupAccessState(
          { kind: 'integration', id: resolveAccessControlBlockType(normalizedBlockType) },
          policy.groupConfig,
          INTEGRATION_REQUEST_CATALOG
        )
      : 'allowed'
  if (groupState === 'unavailable') return 'denied'
  if (groupState === 'allowed' && isPermittedBy(policy.allowlist, blockType)) {
    return unconfigured ? 'unconfigured' : 'available'
  }
  if (unconfigured) return 'denied'
  return isPermittedBy(policy.deploymentAllowlist, blockType) ? 'requestable' : 'denied'
}

/** Membership in a resolved allowlist, where `null` is unrestricted and exempt blocks always pass. */
function isPermittedBy(allowlist: ReadonlySet<string> | null, blockType: string): boolean {
  if (allowlist === null || isBlockTypeAccessControlExempt(blockType)) return true
  return allowlist.has(resolveAccessControlBlockType(blockType.toLowerCase()))
}
