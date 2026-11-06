import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { NextRequest } from 'next/server'
import { v2CopyFileItemsContract } from '@/lib/api/contracts/v2/file-copy'
import { V2_PARSE_DEFAULTS, v2InvalidBodyResponse } from '@/lib/api/server/routes/v2-json-route'
import { parseRequest } from '@/lib/api/server/validation'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import { createFileCopyCliTransport } from '@/lib/mothership/agent-cli/file-copy-transport'
import { createResourceEffectTransport } from '@/lib/mothership/agent-cli/resource-effects'
import type { ResourceChange } from '@/lib/mothership/generated/resources'
import { sandboxCallbackContext } from '@/lib/mothership/tools/sandbox-callback'
import {
  recordSandboxResourceEffects,
  type SandboxResourceScope,
} from '@/lib/mothership/tools/sandbox-resources'
import { copiesWithinWorkspaces } from '@/lib/workspace-files/application/copy-operation'

const logger = createLogger('SandboxFileCopy')

/** A live callback delegates the exact pair; the shared operation owns both authorization and durable provenance. */
export async function proxySandboxFileCopyRequest(
  request: Request,
  token: string,
  scope: SandboxResourceScope
): Promise<Response> {
  const unavailable = () =>
    Response.json(
      { error: 'Paired file owner routing is unavailable or contradictory' },
      { status: 403 }
    )
  if (
    (scope.fileOwnerProtocolVersion !== 1 && !scope.workspaceFileCopy) ||
    request.headers.has('x-mothership-file-owner') ||
    request.headers.has('x-mothership-workspace-id')
  )
    return unavailable()
  if (request.method !== 'POST')
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  const parsed = await parseRequest(
    v2CopyFileItemsContract,
    new NextRequest(request.clone()),
    {},
    {
      ...V2_PARSE_DEFAULTS,
      invalidJsonResponse: () => v2InvalidBodyResponse(request),
    }
  )
  if (!parsed.success) return parsed.response
  // Without the negotiated protocol only workspace owners exist for this lease.
  if (scope.fileOwnerProtocolVersion !== 1 && !copiesWithinWorkspaces(parsed.data.body))
    return unavailable()
  const endpoint = getInternalApiBaseUrl()
  const transport = createFileCopyCliTransport(
    endpoint,
    sandboxCallbackContext(scope),
    parsed.data.body
  )
  const forwarded = new Request(`${endpoint.replace(/\/$/, '')}${v2CopyFileItemsContract.path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(parsed.data.body),
    signal: request.signal,
  })
  const effects: ResourceChange[] = []
  let completed: Response | undefined
  const dispatch: typeof fetch = async (input, init) => {
    completed = await transport(input, init)
    return completed
  }
  let response: Response
  try {
    response = await createResourceEffectTransport(endpoint, dispatch, effects)(forwarded)
  } catch (error) {
    if (!completed) throw error
    response = completed
    logger.warn('Copy callback effect projection failed after API completion', {
      toolCallId: scope.toolCallId,
    })
  }
  const requestId = generateId()
  await recordSandboxResourceEffects(
    token,
    scope,
    effects.map((effect, index): ResourceChange & { effectId: string } => {
      const effectId = `${scope.runId}:${scope.toolCallId}:${requestId}:${index}`
      if (!scope.organizationId) return { ...effect, effectId }
      /** Organization chats address workspace resources explicitly, as the workspace route does. */
      if (effect.op === 'upsert' && effect.resource.owner?.entityType === 'workspace')
        return {
          ...effect,
          effectId,
          resource: { ...effect.resource, workspaceId: effect.resource.owner.entityId },
        }
      if (
        effect.op === 'refresh' &&
        'owner' in effect.resource &&
        effect.resource.owner?.entityType === 'workspace'
      )
        return {
          ...effect,
          effectId,
          resource: { ...effect.resource, workspaceId: effect.resource.owner.entityId },
        }
      return { ...effect, effectId }
    })
  )
  return response
}
