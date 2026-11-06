import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { NextRequest } from 'next/server'
import { v2CopyFileItemsContract } from '@/lib/api/contracts/v2/file-copy'
import { markCopilotRequest } from '@/lib/api/server/routes/copilot-request'
import { matchV2Route } from '@/lib/api/server/routes/in-process-transport'
import { V2_PARSE_DEFAULTS } from '@/lib/api/server/routes/v2-json-route'
import { DEFAULT_MAX_JSON_BODY_BYTES, parseRequest } from '@/lib/api/server/validation'
import { withWorkspaceInvocationScope } from '@/lib/core/application/workspace-invocation-scope'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import {
  assertContentLengthWithinLimit,
  isPayloadSizeLimitError,
  readStreamToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import { createResourceEffectTransport } from '@/lib/mothership/agent-cli/resource-effects'
import { resolveInvocationWorkspace } from '@/lib/mothership/application/workspace-target'
import { createSessionContentGate, deliverSandboxResponse } from '@/lib/mothership/content-delivery'
import { FileOperationOwner } from '@/lib/mothership/generated/file-owner'
import type { ResourceChange } from '@/lib/mothership/generated/resources'
import { forwardableSandboxHeaders } from '@/lib/mothership/tools/sandbox-callback'
import { proxySandboxFileCopyRequest } from '@/lib/mothership/tools/sandbox-file-copy'
import { proxySandboxProjectFileRequest } from '@/lib/mothership/tools/sandbox-project-files'
import {
  readSandboxResourceScope,
  recordSandboxResourceEffects,
  type SandboxResourceScope,
} from '@/lib/mothership/tools/sandbox-resources'
import { chatSandboxSessionKey } from '@/lib/mothership/tools/sandbox-session-key'
import { copiesWithinWorkspaces } from '@/lib/workspace-files/application/copy-operation'

const logger = createLogger('MothershipSandboxResourceTransport')

/** Private callback observes the real authenticated v2 request without changing its body or API contract. */
export async function proxySandboxResourceRequest(
  callback: Request,
  token: string
): Promise<Response> {
  let request = callback
  const url = new URL(request.url)
  const prefix = `/api/mothership/sandbox/${token}`
  const path = url.pathname.slice(prefix.length)
  let validPath = false
  try {
    validPath =
      url.pathname.startsWith(`${prefix}/api/v2/`) &&
      !path.split('/').some((part) => /^(?:\.|\.\.)$/.test(decodeURIComponent(part))) &&
      !/%5c|%00/i.test(path)
  } catch {
    /** Malformed percent encodings cannot select a generated API route. */
  }
  if (!validPath) return Response.json({ error: 'Invalid sandbox API path' }, { status: 400 })
  const scope = await readSandboxResourceScope(token, request.headers.get('x-api-key'))
  if (!scope)
    return Response.json({ error: 'Sandbox tool execution is no longer active' }, { status: 403 })
  /**
   * Copies bind both owners under the paired grant. Project owners need the negotiated protocol,
   * and an admitted lease copies between workspaces without it; a copy naming a Project owner is
   * refused there. Otherwise workspace copies and invalid bodies keep the workspace route and its
   * v2 validation response.
   */
  if (path === v2CopyFileItemsContract.path) {
    const buffered = await bufferCopyRequest(request)
    if (buffered instanceof Response) return buffered
    request = buffered
    if (
      scope.fileOwnerProtocolVersion === 1 ||
      scope.workspaceFileCopy ||
      (await copiesBeyondWorkspaces(request))
    )
      return proxySandboxFileCopyRequest(request, token, scope)
  }
  const ownerHeader = request.headers.get('x-mothership-file-owner')
  let owner: FileOperationOwner | undefined
  if (ownerHeader !== null) {
    if (scope.fileOwnerProtocolVersion !== 1 || request.headers.has('x-mothership-workspace-id'))
      return Response.json(
        { error: 'File owner routing is unavailable or contradictory' },
        { status: 403 }
      )
    try {
      owner = FileOperationOwner.parse(JSON.parse(ownerHeader))
    } catch {
      return Response.json({ error: 'Invalid file owner' }, { status: 400 })
    }
    const ownerPath =
      owner.entityType === 'project'
        ? `/api/v2/projects/${encodeURIComponent(owner.entityId)}/files`
        : '/api/v2/files'
    if (path !== ownerPath && !path.startsWith(`${ownerPath}/`))
      return Response.json({ error: 'File owner does not match the API path' }, { status: 400 })
    if (owner.entityType === 'project') {
      return proxySandboxProjectFileRequest(request, token, path, url.search, scope, owner.entityId)
    }
  }
  let targetWorkspaceId: string
  try {
    const target = await resolveInvocationWorkspace(
      scope,
      owner?.entityId ?? request.headers.get('x-mothership-workspace-id') ?? undefined
    )
    targetWorkspaceId = target.workspaceId
  } catch (error) {
    const failure = asOrchestrationError(error)
    return Response.json(
      { error: failure?.message ?? 'Workspace authorization failed' },
      { status: statusForOrchestrationError(failure?.code) }
    )
  }
  return withWorkspaceInvocationScope(
    { workspaceId: targetWorkspaceId, organizationId: scope.organizationId },
    () => proxyAuthorizedSandboxRequest(request, token, path, url, scope, targetWorkspaceId)
  )
}

async function proxyAuthorizedSandboxRequest(
  request: Request,
  token: string,
  path: string,
  url: URL,
  scope: SandboxResourceScope,
  targetWorkspaceId: string
): Promise<Response> {
  const endpoint = getInternalApiBaseUrl()
  const target = `${endpoint.replace(/\/$/, '')}${path}${url.search}`
  const init: RequestInit & { duplex: 'half' } = {
    method: request.method,
    headers: forwardableSandboxHeaders(request),
    signal: request.signal,
    redirect: 'manual',
    duplex: 'half',
    ...(request.method === 'GET' || request.method === 'HEAD' ? {} : { body: request.body }),
  }
  const forwarded = new Request(target, init)
  const effects: ResourceChange[] = []
  let response: Response | undefined
  let dispatched = false
  /** Invoke the same handler with private request identity; the declared use case still authorizes current domain access. */
  const matched = matchV2Route(path)
  if (!matched) return Response.json({ error: 'API route not found' }, { status: 404 })
  const method = request.method === 'HEAD' ? 'GET' : request.method
  const handler = Reflect.get(await matched.load(), method)
  if (typeof handler !== 'function')
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  const dispatch = async () => {
    const privateRequest = new NextRequest(forwarded)
    markCopilotRequest(privateRequest, {
      userId: scope.userId,
      workspaceId: targetWorkspaceId,
      chatId: scope.chatId,
    })
    const result = await handler(privateRequest, {
      params: Promise.resolve(matched.params),
    })
    if (!(result instanceof Response)) throw new Error('Invalid sandbox API response')
    return result
  }
  const gate = createSessionContentGate({
    sessionKey: chatSandboxSessionKey(scope.chatId),
    workspaceId: targetWorkspaceId,
    actorUserId: scope.userId,
  })
  const deliver = async () => {
    dispatched = true
    response = await deliverSandboxResponse(gate, dispatch, scope.toolCallId)
    return response
  }
  try {
    await createResourceEffectTransport(endpoint, deliver, effects)(forwarded)
  } catch (error) {
    if (!dispatched) response = await deliver()
    else if (!response) throw error
    logger.warn('Sandbox resource projection failed after API response', {
      toolCallId: scope.toolCallId,
    })
  }
  if (!response) throw new Error('Sandbox API request returned no response')
  const requestId = generateId()
  await recordSandboxResourceEffects(
    token,
    scope,
    effects.map((effect, index) => {
      const effectId = `${scope.runId}:${scope.toolCallId}:${requestId}:${index}`
      if (!scope.organizationId) return { ...effect, effectId }
      switch (effect.op) {
        case 'upsert':
          return {
            ...effect,
            effectId,
            resource: { ...effect.resource, workspaceId: targetWorkspaceId },
          }
        case 'remove':
          return {
            ...effect,
            effectId,
            resource: { ...effect.resource, workspaceId: targetWorkspaceId },
          }
        case 'refresh':
          return {
            ...effect,
            effectId,
            resource: { ...effect.resource, workspaceId: targetWorkspaceId },
          }
        case 'clear_view':
          return {
            ...effect,
            effectId,
            resource: { ...effect.resource, workspaceId: targetWorkspaceId },
          }
      }
    })
  )
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

/**
 * Reads a copy body once, under the v2 body cap, so the protocol check and whichever copy path
 * handles it each read an in-memory copy. Parsing a clone of the live stream instead would hang on
 * an oversized body: cancelling one branch of a teed stream waits for the unread other branch.
 */
async function bufferCopyRequest(request: Request): Promise<Request | Response> {
  if (!request.body) return request
  try {
    assertContentLengthWithinLimit(request.headers, DEFAULT_MAX_JSON_BODY_BYTES, 'Request body')
    const body = await readStreamToBufferWithLimit(request.body, {
      maxBytes: DEFAULT_MAX_JSON_BODY_BYTES,
      label: 'Request body',
      signal: request.signal,
    })
    return new Request(request, { body: new Uint8Array(body) })
  } catch (error) {
    if (isPayloadSizeLimitError(error)) return V2_PARSE_DEFAULTS.payloadTooLargeResponse()
    throw error
  }
}

/**
 * A valid copy naming a non-workspace source or destination needs the file-owner protocol. Parsed
 * as the copy route parses it: an invalid body stays on the workspace route, which returns its own
 * 400.
 */
async function copiesBeyondWorkspaces(request: Request): Promise<boolean> {
  const parsed = await parseRequest(
    v2CopyFileItemsContract,
    new NextRequest(request.clone()),
    {},
    V2_PARSE_DEFAULTS
  )
  return parsed.success && !copiesWithinWorkspaces(parsed.data.body)
}
