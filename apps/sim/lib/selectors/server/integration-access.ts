import type { Principal } from '@sim/auth/principal'
import { getIntegrationTypesForOAuthServiceId } from '@sim/deployment-config/integration-availability'
import { createLogger } from '@sim/logger'
import { allowedIntegrationTypes } from '@/lib/integrations/principal-scope.server'
import {
  isBlockTypeAccessControlExempt,
  resolveAccessControlBlockType,
} from '@/lib/permission-groups/block-access'
import type {
  SelectorCredentialPolicy,
  ServerSelectorAttachment,
} from '@/lib/selectors/server/types'
import { IntegrationNotAllowedError } from '@/ee/access-control/utils/permission-check'

const logger = createLogger('SelectorIntegrationAccess')

/**
 * The OAuth services a selector execution actually reaches.
 *
 * `serviceIds` answers a different question — which *credentials* the selector
 * accepts. The two diverge whenever one provider API is reachable with several
 * of its sibling connections: `google.drive` accepts a Drive, Docs, Sheets or
 * Forms credential because all four carry Drive scope, and `sharepoint.sites`
 * accepts a SharePoint or an Excel one. Gating on the accepted set asked
 * whether *any* of them was permitted, so a group that allowed
 * `google_sheets_v2` and excluded `google_drive` could still read Drive through
 * `google.drive`.
 *
 * The declaration therefore names its own resource, and that is what the
 * allowlist judges. The credential's provider id is deliberately not consulted:
 * it describes the key, not the API the selector calls, and narrowing by it
 * gated Drive reads on whether a Sheets connection was permitted.
 */
export function selectorResourceServiceIds(policy: SelectorCredentialPolicy): readonly string[] {
  return policy.resourceServiceId ? [policy.resourceServiceId] : policy.serviceIds
}

/**
 * The block types an allowlist decision about this selector is made against.
 *
 * Two independent sources, because the OAuth credential catalog cannot identify
 * every selector that reaches a third-party API. A selector authenticated from
 * raw context fields (CloudWatch's AWS keys, IMAP's host and password) carries
 * no credential policy, and an API-key integration (Snowflake, NetSuite,
 * Harmonic) owns no OAuth catalog entry, so its service id maps to no block
 * type — both used to yield an empty list and pass the gate untested. They
 * declare `integrationBlockTypes` instead, and it wins over the catalog when
 * both are present.
 *
 * An empty result means "no integration identity", which is a pass. That is
 * reserved for the internal selectors — workspace files, knowledge bases,
 * tables — which read only Sim's own data;
 * `selectorIntegrationCoverage` in the manifest test keeps every
 * `provider-server` selector out of it.
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
 * integration identity all pass through. The last is now reserved for the
 * internal selectors — workspace files, knowledge bases, tables — which read
 * only Sim's own data and are not an integration at all. Every selector that
 * reaches a third party has an identity, either through the OAuth credential
 * catalog or through the `integrationBlockTypes` a raw-context or API-key
 * selector declares; see {@link selectorIntegrationBlockTypes}.
 *
 * One service can still map to several block types — the `google-drive` entry
 * authenticates both `google_drive` and `google_slides_v2` — and any of them
 * satisfies the check. That is the catalog's own shared-service convention and
 * not a widening: both block types hold the same Drive scope on the same
 * credential, so permitting either already grants the access.
 */
export async function assertSelectorIntegrationAllowed(input: {
  principal: Principal
  workspaceId: string
  blockTypes: readonly string[]
}): Promise<void> {
  const blockTypes = input.blockTypes
  if (blockTypes.length === 0) return

  const allowlist = await allowedIntegrationTypes(input.principal, input.workspaceId)
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
