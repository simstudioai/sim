import type { Principal } from '@sim/auth/principal'
import { getIntegrationTypesForOAuthServiceId } from '@sim/deployment-config/integration-availability'
import { createLogger } from '@sim/logger'
import { allowedIntegrationTypes } from '@/lib/integrations/principal-scope.server'
import { credentialProviderMatchesService, getServiceConfigByServiceId } from '@/lib/oauth/utils'
import {
  isBlockTypeAccessControlExempt,
  resolveAccessControlBlockType,
} from '@/lib/permission-groups/block-access'
import { IntegrationNotAllowedError } from '@/ee/access-control/utils/permission-check'

const logger = createLogger('SelectorIntegrationAccess')

/**
 * The OAuth services this execution actually stands for.
 *
 * A selector declares the services whose credentials it accepts, and most
 * declare exactly one. A few accept two — `sharepoint`/`microsoft-excel`,
 * `onedrive`/`microsoft-word` — and there the declaration alone is too wide: a
 * member permitted only one of the pair would pass a check that asks whether
 * *any* declared service is allowed. The resolved credential's provider id is
 * the server-trusted narrowing, loaded during credential binding from the
 * stored row rather than taken from the request, so it names which of the pair
 * the caller is really reaching.
 *
 * Falls back to the full declaration when there is no provider id (a fixed
 * token carries none) or when it matches none of them, which keeps the check
 * from silently widening to "no integration identity" on a shape it cannot
 * narrow.
 */
function resolveBoundServiceIds(
  serviceIds: readonly string[],
  providerId: string | undefined
): readonly string[] {
  if (!providerId) return serviceIds
  const bound = serviceIds.filter((serviceId) => {
    const service = getServiceConfigByServiceId(serviceId)
    return service ? credentialProviderMatchesService(providerId, service) : false
  })
  return bound.length > 0 ? bound : serviceIds
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
 * that stands for no person, and normalizes the policy side through
 * `toAccessControlAllowlist`. The checked side is successor-resolved the same
 * way, so a group naming `slack` and a selector bound to `slack_v2` match.
 *
 * A `null` allowlist, a caller no group governs, and a selector with no
 * integration identity all pass through. The last covers two real shapes: an
 * internal selector (workspace files, knowledge bases) declares no credential
 * policy at all, and an API-key integration — Snowflake, NetSuite, Harmonic —
 * owns no OAuth entry in the deployment integration catalog and therefore maps
 * to no block type. Treating an unmapped service as allowed is deliberate and
 * is what the credential catalog already does; see
 * `isOAuthServiceAllowedByIntegrationTypes`.
 */
export async function assertSelectorIntegrationAllowed(input: {
  principal: Principal
  workspaceId: string
  serviceIds: readonly string[]
  providerId?: string
}): Promise<void> {
  if (input.serviceIds.length === 0) return

  const allowlist = await allowedIntegrationTypes(input.principal, input.workspaceId)
  if (allowlist === null) return

  const blockTypes = resolveBoundServiceIds(input.serviceIds, input.providerId).flatMap(
    (serviceId) => getIntegrationTypesForOAuthServiceId(serviceId)
  )
  if (blockTypes.length === 0) return

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
