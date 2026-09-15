import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { NextRequest } from 'next/server'
import {
  v2GetBlockContract,
  v2GetToolContract,
  v2ListBlocksContract,
  v2ListConnectorTypesContract,
  v2ListToolsContract,
} from '@/lib/api/contracts/v2/catalog'
import { v2DownloadFileContract, v2ReadFileTextContract } from '@/lib/api/contracts/v2/files'
import { markCopilotRequest } from '@/lib/api/server/routes/copilot-request'
import { matchV2Route } from '@/lib/api/server/routes/in-process-transport'
import { withWorkspaceInvocationScope } from '@/lib/core/application/workspace-invocation-scope'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import { recordExistingSessionFileInput } from '@/lib/execution/remote-sandbox/session-file-provenance'
import { createResourceEffectTransport } from '@/lib/mothership/agent-cli/resource-effects'
import { resolveInvocationWorkspace } from '@/lib/mothership/application/workspace-target'
import type { ResourceChange } from '@/lib/mothership/generated/resources'
import {
  readSandboxResourceScope,
  recordSandboxResourceEffects,
} from '@/lib/mothership/tools/sandbox-resources'
import { chatSandboxSessionKey } from '@/lib/mothership/tools/sandbox-session-key'
import { observeWorkspaceFileDelivery } from '@/lib/workspace-files/application/file-delivery-observer'

const logger = createLogger('MothershipSandboxResourceTransport')

/** Private callback observes the real authenticated v2 request without changing its body or API contract. */
export async function proxySandboxResourceRequest(
  request: Request,
  token: string
): Promise<Response> {
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
  let targetWorkspaceId: string
  try {
    const target = await resolveInvocationWorkspace(
      scope,
      request.headers.get('x-mothership-workspace-id') ?? undefined
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
  scope: NonNullable<Awaited<ReturnType<typeof readSandboxResourceScope>>>,
  targetWorkspaceId: string
): Promise<Response> {
  const endpoint = getInternalApiBaseUrl()
  const target = `${endpoint.replace(/\/$/, '')}${path}${url.search}`
  const headers = new Headers(request.headers)
  for (const header of [
    'host',
    'cookie',
    'authorization',
    'connection',
    'transfer-encoding',
    'x-mothership-workspace-id',
  ])
    headers.delete(header)
  headers.delete('x-api-key')
  const init: RequestInit & { duplex: 'half' } = {
    method: request.method,
    headers,
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
  // Only these producer-owned catalog responses contain no workspace data or execution output.
  const publicCatalog =
    method === 'GET' &&
    [v2ListToolsContract, v2GetToolContract, v2ListConnectorTypesContract].some(
      (contract) =>
        contract.path.replace(/\[([^\]]+)\]/g, (_match, key) =>
          encodeURIComponent(matched.params[key] ?? '')
        ) === path
    )
  const blockCatalog =
    method === 'GET' &&
    [v2ListBlocksContract, v2GetBlockContract].find(
      (contract) =>
        contract.path.replace(/\[([^\]]+)\]/g, (_match, key) =>
          encodeURIComponent(matched.params[key] ?? '')
        ) === path
    )
  const recordInput = (safe: boolean) =>
    recordExistingSessionFileInput(chatSandboxSessionKey(scope.chatId), safe)
  const fileRead =
    method === 'GET' &&
    [v2DownloadFileContract, v2ReadFileTextContract].some(
      (contract) =>
        contract.path.replace(/\[([^\]]+)\]/g, (_match, key) =>
          encodeURIComponent(matched.params[key] ?? '')
        ) === path
    )
  const deliver = async () => {
    dispatched = true
    if (!publicCatalog && !fileRead && !blockCatalog) await recordInput(false)
    let observed = false
    const result = await observeWorkspaceFileDelivery(async (provenance) => {
      await recordInput(provenance?.status === 'exact' && provenance.entries.length === 0)
      observed = true
    }, dispatch)
    try {
      if (fileRead && !observed && result.ok && result.body) await recordInput(false)
      if (blockCatalog && result.ok && result.body) {
        const parsed = blockCatalog.response.schema.safeParse(await result.clone().json())
        const data = parsed.success ? parsed.data.data : undefined
        const safe = Array.isArray(data)
          ? data.every((block) => block.source === 'builtin')
          : data?.source === 'builtin'
        if (!safe) await recordInput(false)
      }
    } catch (error) {
      await result.body?.cancel().catch(() => {})
      throw error
    }
    response = result
    return result
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
