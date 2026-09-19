import {
  isChatEnabled,
  isInboxEnabled,
  isInvitationsDisabled,
  isPublicApiDisabled,
  isSandboxesEnabled,
  isSsoEnabled,
} from '@/lib/core/config/env-flags'
import { PLATFORM_FEATURES } from '@/lib/permission-groups/features'
import { FILE_SHARE_AUTH_TYPES } from '@/lib/permission-groups/fields'
import type { AccessRequestCatalogContext } from '@/ee/access-requests/lib/catalog-registry'
import {
  type AccessRequestCatalog,
  type AccessRequestTarget,
  createAccessRequestCatalog,
} from '@/ee/access-requests/lib/targets'

/** Small navigation and credit-limit checks never load or enumerate the integration registries. */
export async function loadAccessRequestCatalog(
  context: AccessRequestCatalogContext,
  targetKind?: AccessRequestTarget['kind']
): Promise<AccessRequestCatalog> {
  if (
    targetKind &&
    ['feature', 'usage_limit', 'file_share_auth', 'chat_deploy_auth'].includes(targetKind)
  )
    return createAccessRequestCatalog({
      integrations: [],
      providers: [],
      models: [],
      tools: [],
      knowledgeConnectors: [],
    })
  const { loadAccessRequestRegistryCatalog } = await import(
    '@/ee/access-requests/lib/catalog-registry'
  )
  return loadAccessRequestRegistryCatalog(context, targetKind)
}

/** Enumerates public targets; scope, role, current policy, usage, and pending state remain caller-owned. */
export function listAccessRequestTargets(catalog: AccessRequestCatalog): AccessRequestTarget[] {
  return [
    ...PLATFORM_FEATURES.map(
      (feature): AccessRequestTarget => ({ kind: 'feature', configKey: feature.configKey })
    ),
    ...[...catalog.integrations.keys()].map(
      (id): AccessRequestTarget => ({ kind: 'integration', id })
    ),
    ...[...catalog.providers.keys()].map((id): AccessRequestTarget => ({ kind: 'provider', id })),
    ...[...catalog.models.values()].map(({ id }): AccessRequestTarget => ({ kind: 'model', id })),
    ...[...catalog.tools.keys()].map((id): AccessRequestTarget => ({ kind: 'tool', id })),
    ...[...catalog.knowledgeConnectors.keys()].map(
      (id): AccessRequestTarget => ({ kind: 'knowledge_connector', id })
    ),
    ...FILE_SHARE_AUTH_TYPES.map((id): AccessRequestTarget => ({ kind: 'file_share_auth', id })),
    ...FILE_SHARE_AUTH_TYPES.map((id): AccessRequestTarget => ({ kind: 'chat_deploy_auth', id })),
    { kind: 'usage_limit', id: 'member' },
  ]
}

/** Group edits cannot enable a deployment-disabled feature or sharing authentication mode. */
export function getAccessRequestDeploymentUnavailableReason(
  target: AccessRequestTarget
): string | null {
  if (
    (target.kind === 'file_share_auth' || target.kind === 'chat_deploy_auth') &&
    target.id === 'sso' &&
    !isSsoEnabled
  ) {
    return 'SSO is not available on this deployment.'
  }
  if (target.kind !== 'feature') return null
  const disabled =
    (target.configKey === 'hideCopilot' && !isChatEnabled) ||
    (target.configKey === 'hideInboxTab' && !isInboxEnabled) ||
    (target.configKey === 'hideSandboxesTab' && !isSandboxesEnabled) ||
    (target.configKey === 'disableInvitations' && isInvitationsDisabled) ||
    (target.configKey === 'disablePublicApi' && isPublicApiDisabled)
  return disabled
    ? 'This feature is disabled for this deployment. An organization permission change cannot enable it.'
    : null
}
