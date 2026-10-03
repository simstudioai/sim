import type { Principal } from '@sim/auth/principal'
import { getIntegrationTypesForOAuthServiceId } from '@sim/deployment-config/integration-availability'
import { createLogger } from '@sim/logger'
import {
  allowedIntegrationTypes,
  allowedOrganizationIntegrationTypes,
} from '@/lib/integrations/principal-scope.server'
import { isBlockTypeAccessControlExempt } from '@/lib/permission-groups/block-access'
import { resolveAccessControlBlockType } from '@/lib/permission-groups/integration-allowlist'
import type {
  SelectorCredentialPolicy,
  ServerSelectorAttachment,
} from '@/lib/selectors/server/types'
import { IntegrationNotAllowedError } from '@/ee/access-control/utils/permission-check'

const logger = createLogger('SelectorIntegrationAccess')

/**
 * The OAuth service a selector execution actually reaches — its own resource
 * rather than the set of credentials it accepts. See
 * {@link SelectorCredentialPolicy} for why those two differ and why the bound
 * credential's provider id is never consulted.
 */
function selectorResourceServiceIds(policy: SelectorCredentialPolicy): readonly string[] {
  return policy.resourceServiceId ? [policy.resourceServiceId] : policy.serviceIds
}

/**
 * The block types an allowlist decision about this selector is made against.
 *
 * Two independent sources, because the OAuth credential catalog cannot identify
 * every selector that reaches a third-party API; the declared
 * `integrationBlockTypes` cover the shapes it misses and win over the catalog
 * when both are present. See
 * {@link ServerSelectorAttachment.integrationBlockTypes} for which shapes those
 * are.
 *
 * An empty result means "no integration identity", which is a pass. That is
 * reserved for the internal selectors — workspace files, knowledge bases,
 * tables — which read only Sim's own data. `integration-access.test.ts` keeps
 * every provider selector out of it: "gives every provider selector an
 * integration identity" walks the whole manifest and fails on the first
 * provider-backed selector this function answers with an empty list.
 */
export function selectorIntegrationBlockTypes(
  attachment: Pick<ServerSelectorAttachment, 'credential' | 'integrationBlockTypes'>
): readonly string[] {
  if (attachment.integrationBlockTypes?.length) return attachment.integrationBlockTypes
  if (!attachment.credential) return []
  return selectorResourceServiceIds(attachment.credential).flatMap((serviceId) =>
    getIntegrationTypesForOAuthServiceId(serviceId)
  )
}

/**
 * Refuses a selector execution whose integration the caller's permission group
 * does not permit.
 *
 * `POST /api/selectors/execute` reaches a provider's API with the caller's
 * credential, so it is a use of the integration and not merely a picker. The
 * authorization funnel cannot apply the rule: `allowedIntegrations` is a
 * parameterized decision about *which* integration, and the funnel knows only
 * the principal, the workspace and the operation. Hence the assertion here,
 * ahead of the provider call, exactly as `knowledge.connectors` is asserted
 * ahead of the connector write.
 *
 * The decision is the one the block-access path makes. `allowedIntegrationTypes`
 * is the shared gate — it intersects the caller's permission group with the
 * deployment's `ALLOWED_INTEGRATIONS`, contributes no group half for a principal
 * that stands for no person, and canonicalizes each half through
 * `resolveAccessControlBlockType` *before* intersecting, so a group naming
 * `slack_v2` and a deployment naming `slack` still meet. The checked side is
 * successor-resolved the same way, so a group naming `slack` and a selector
 * bound to `slack_v2` match.
 *
 * A `null` allowlist, a caller no group governs, and a selector with no
 * integration identity all pass through; see {@link selectorIntegrationBlockTypes}
 * for why the last of those is reserved for the internal selectors.
 *
 * One service can still map to several block types — the `google-drive` entry
 * authenticates both `google_drive` and `google_slides_v2` — and any of them
 * satisfies the check. That is the catalog's own shared-service convention and
 * not a widening: both block types hold the same Drive scope on the same
 * credential, so permitting either already grants the access.
 */
export async function assertSelectorIntegrationAllowed(input: {
  principal: Principal
  workspaceId?: string
  organizationId?: string
  blockTypes: readonly string[]
}): Promise<void> {
  const blockTypes = input.blockTypes
  if (blockTypes.length === 0) return

  const allowlist = input.organizationId
    ? await allowedOrganizationIntegrationTypes(input.organizationId)
    : input.workspaceId
      ? await allowedIntegrationTypes(input.principal, input.workspaceId)
      : new Set<string>()
  if (allowlist === null) return

  const allowed = blockTypes.some(
    (blockType) =>
      isBlockTypeAccessControlExempt(blockType) ||
      allowlist.has(resolveAccessControlBlockType(blockType).toLowerCase())
  )
  if (allowed) return

  logger.warn('Selector integration blocked by integration allowlist', {
    workspaceId: input.workspaceId,
    blockTypes,
  })
  throw new IntegrationNotAllowedError(blockTypes[0])
}
