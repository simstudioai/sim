import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  listManagedAgentOptionsContract,
  MANAGED_AGENT_BYOK_PROVIDER,
  type ManagedAgentOption,
  type ManagedAgentResource,
} from '@/lib/api/contracts/managed-agents'
import { parseRequest } from '@/lib/api/server'
import { getBYOKKey } from '@/lib/api-key/byok'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { AGENT_MEMORY_BETA, managedAgentsList } from '@/lib/managed-agents/session-client'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('ManagedAgentListAPI')

interface AnthropicListRow {
  id?: string
  name?: string | null
  config?: { type?: 'cloud' | 'self_hosted' }
}

/**
 * Anthropic list path + the beta header it requires. Memory-store endpoints
 * use `agent-memory-2026-07-22`; combining it with the managed-agents beta is
 * a documented 400, so each resource declares exactly one.
 */
const RESOURCE_ENDPOINTS: Record<ManagedAgentResource, { path: string; beta?: string }> = {
  agents: { path: '/v1/agents' },
  environments: { path: '/v1/environments' },
  vaults: { path: '/v1/vaults' },
  'memory-stores': { path: '/v1/memory_stores', beta: AGENT_MEMORY_BETA },
}

function toOption(
  resource: ManagedAgentResource,
  row: AnthropicListRow
): ManagedAgentOption | null {
  if (!row.id) return null
  const name = row.name?.trim()
  if (resource === 'environments') {
    const type = row.config?.type
    const suffix = type ? ` (${type})` : ''
    return { id: row.id, label: `${name || row.id}${suffix}` }
  }
  if (resource === 'vaults') {
    return { id: row.id, label: name || row.id }
  }
  return { id: row.id, label: name ? `${name} (${row.id})` : row.id }
}

/**
 * Resolves Managed Agent dropdown options (agents / environments / vaults /
 * memory stores) for the block editor. The workspace's Claude Platform BYOK
 * key is decrypted server-side and never crosses the client boundary — the
 * browser only ever receives `{ id, label }` options.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(listManagedAgentOptionsContract, request, {})
  if (!parsed.success) return parsed.response
  const { workspaceId, resource } = parsed.data.query

  const permission = await getUserEntityPermissions(auth.userId, 'workspace', workspaceId)
  if (!permission) {
    return NextResponse.json({ error: 'Workspace access denied' }, { status: 403 })
  }

  const byok = await getBYOKKey(workspaceId, MANAGED_AGENT_BYOK_PROVIDER)
  if (!byok) {
    // No Claude Platform key linked yet — return an empty list so the
    // dropdown renders cleanly rather than erroring.
    return NextResponse.json({ options: [] })
  }

  try {
    const endpoint = RESOURCE_ENDPOINTS[resource]
    const rows = await managedAgentsList<AnthropicListRow>({
      apiKey: byok.apiKey,
      path: endpoint.path,
      beta: endpoint.beta,
      signal: request.signal,
    })
    const options = rows
      .map((row) => toOption(resource, row))
      .filter((option): option is ManagedAgentOption => option !== null)
    return NextResponse.json({ options })
  } catch (error) {
    // Some beta workspaces may not expose every resource (e.g. vaults). Log
    // and degrade to an empty list rather than breaking the editor.
    logger.warn('Managed agent list proxy failed', {
      workspaceId,
      resource,
      error: getErrorMessage(error),
    })
    return NextResponse.json({ options: [] })
  }
})
