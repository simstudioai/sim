import { resolveBYOKKey } from '@/lib/api-key/byok'
import { env } from '@/lib/core/config/env'
import { isProd } from '@/lib/core/config/env-flags'
import { isFeatureEnabledStrict } from '@/lib/core/config/feature-flags'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getWorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'

export interface PiSearchPreflight {
  brokerBaseUrl: string
  workspaceId: string
  executionId: string
  exaApiKey: string
  exaKeyId: string
}

function resolveBrokerBaseUrl(): string {
  const configured = env.PI_EXA_BROKER_BASE_URL?.trim() || getBaseUrl()
  const url = new URL(configured)
  if (url.protocol !== 'https:' && (isProd || url.protocol !== 'http:')) {
    throw new Error('Pi internet search broker URL must use HTTPS (or HTTP in local development)')
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '' && url.pathname !== '/')
  ) {
    throw new Error('Pi internet search broker URL must be a canonical origin')
  }
  return url.origin
}

export async function preflightPiSearch(params: {
  workspaceId?: string
  executionId?: string
  userId?: string
}): Promise<PiSearchPreflight> {
  if (!params.workspaceId || !params.executionId) {
    throw new Error('Create PR internet search requires a workspace execution')
  }
  if (!env.INTERNAL_API_SECRET) {
    throw new Error('Create PR internet search is not configured on this deployment')
  }

  const workspace = await getWorkspaceWithOwner(params.workspaceId, { includeArchived: true })
  if (!workspace) throw new Error('Workspace not found')
  const flag = await isFeatureEnabledStrict('pi-create-pr-search', {
    userId: params.userId,
    orgId: workspace.organizationId ?? undefined,
  })
  if (!flag.enabled) {
    throw new Error('Create PR internet search is not enabled for this workspace')
  }

  const byok = await resolveBYOKKey(params.workspaceId, 'exa')
  if (byok.status === 'missing') {
    throw new Error(
      'Create PR internet search requires your workspace Exa key. Add it in Settings > BYOK > Exa.'
    )
  }
  if (byok.status === 'infrastructure_error') {
    throw new Error('Unable to load the workspace Exa key. Please try again.')
  }

  return {
    brokerBaseUrl: resolveBrokerBaseUrl(),
    workspaceId: params.workspaceId,
    executionId: params.executionId,
    exaApiKey: byok.value.apiKey,
    exaKeyId: byok.value.keyId,
  }
}
