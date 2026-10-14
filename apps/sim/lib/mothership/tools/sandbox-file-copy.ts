import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { NextRequest } from 'next/server'
import { v2CopyFileItemsContract } from '@/lib/api/contracts/v2/file-copy'
import { V2_PARSE_DEFAULTS, v2InvalidBodyResponse } from '@/lib/api/server/routes/v2-json-route'
import { parseRequest } from '@/lib/api/server/validation'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import { createFileCopyCliTransport } from '@/lib/mothership/agent-cli/file-copy-transport'
import { createResourceEffectTransport } from '@/lib/mothership/agent-cli/resource-effects'
import { createCopilotResourceAdmission } from '@/lib/mothership/auth/application-delegation'
import type { ResourceChange } from '@/lib/mothership/generated/resources'
import {
  type readSandboxResourceScope,
  recordSandboxResourceEffects,
} from '@/lib/mothership/tools/sandbox-resources'

const logger = createLogger('SandboxFileCopy')

/** A live callback delegates the exact pair; the shared operation owns both authorization and durable provenance. */
export async function proxySandboxFileCopyRequest(
  request: Request,
  token: string,
  scope: NonNullable<Awaited<ReturnType<typeof readSandboxResourceScope>>>
): Promise<Response> {
  if (
    scope.fileOwnerProtocolVersion !== 1 ||
    request.headers.has('x-mothership-file-owner') ||
    request.headers.has('x-mothership-workspace-id')
  )
    return Response.json(
      { error: 'Paired file owner routing is unavailable or contradictory' },
      { status: 403 }
    )
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
  const endpoint = getInternalApiBaseUrl()
  const transport = createFileCopyCliTransport(
    endpoint,
    {
      userId: scope.userId,
      chatId: scope.chatId,
      toolCallId: scope.toolCallId,
      copilotToolExecution: true,
      copilotResourceAdmission: createCopilotResourceAdmission({
        userId: scope.userId,
        invocation: { kind: 'chat', chatId: scope.chatId },
      }),
    },
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
    effects.map((effect, index) => ({
      ...effect,
      effectId: `${scope.runId}:${scope.toolCallId}:${requestId}:${index}`,
    }))
  )
  return response
}
