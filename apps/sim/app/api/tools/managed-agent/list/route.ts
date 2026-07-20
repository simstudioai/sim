import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  listManagedAgentOptionsContract,
  type ManagedAgentOption,
  type ManagedAgentResource,
} from '@/lib/api/contracts/managed-agents'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { CLAUDE_PLATFORM_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/credentials/token-service-accounts/descriptors'
import { AGENT_MEMORY_BETA, managedAgentsList } from '@/lib/managed-agents/session-client'
import { captureServerEvent } from '@/lib/posthog/server'
import { resolveOAuthAccountId, resolveServiceAccountToken } from '@/app/api/auth/oauth/utils'

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
 * memory stores) for the block editor against a selected Claude Platform
 * credential. The credential's API key is decrypted server-side and never
 * crosses the client boundary — the browser only ever receives `{ id, label }`
 * options.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const parsed = await parseRequest(listManagedAgentOptionsContract, request, {})
  if (!parsed.success) return parsed.response
  const { credentialId, resource } = parsed.data.query

  // Authenticates the caller AND verifies they may use this credential.
  const authz = await authorizeCredentialUse(request, {
    credentialId,
    requireWorkflowIdForInternal: false,
  })
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error || 'Unauthorized' }, { status: 403 })
  }

  const resolved = await resolveOAuthAccountId(credentialId)
  if (
    resolved?.credentialType !== 'service_account' ||
    resolved.providerId !== CLAUDE_PLATFORM_SERVICE_ACCOUNT_PROVIDER_ID
  ) {
    return NextResponse.json({ error: 'Not a Claude Platform credential' }, { status: 400 })
  }

  let apiKey: string
  try {
    const token = await resolveServiceAccountToken(
      credentialId,
      CLAUDE_PLATFORM_SERVICE_ACCOUNT_PROVIDER_ID
    )
    apiKey = token.accessToken
  } catch (error) {
    logger.warn('Failed to resolve Claude Platform credential', { error: getErrorMessage(error) })
    return NextResponse.json({ options: [] })
  }

  // Decrypting and using the credential's key is a credential access — record
  // it, mirroring the OAuth token route's service-account audit trail.
  const actorId = authz.requesterUserId
  const workspaceId = resolved.workspaceId ?? authz.workspaceId ?? null
  if (actorId) {
    recordAudit({
      workspaceId,
      actorId,
      action: AuditAction.CREDENTIAL_ACCESSED,
      resourceType: AuditResourceType.CREDENTIAL,
      resourceId: credentialId,
      description: 'Accessed Claude Platform credential to list Managed Agent resources',
      metadata: {
        provider: CLAUDE_PLATFORM_SERVICE_ACCOUNT_PROVIDER_ID,
        credentialType: 'service_account',
      },
      request,
    })
    captureServerEvent(
      actorId,
      'credential_used',
      {
        credential_type: 'service_account',
        provider_id: CLAUDE_PLATFORM_SERVICE_ACCOUNT_PROVIDER_ID,
        ...(workspaceId ? { workspace_id: workspaceId } : {}),
      },
      workspaceId ? { groups: { workspace: workspaceId } } : undefined
    )
  }

  try {
    const endpoint = RESOURCE_ENDPOINTS[resource]
    const rows = await managedAgentsList<AnthropicListRow>({
      apiKey,
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
    logger.warn('Managed agent list proxy failed', { resource, error: getErrorMessage(error) })
    return NextResponse.json({ options: [] })
  }
})
