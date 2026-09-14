import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { NextRequest } from 'next/server'
import { matchV2Route } from '@/lib/api/server/routes/in-process-transport'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import { createResourceEffectTransport } from '@/lib/mothership/agent-cli/resource-effects'
import type { ResourceChange } from '@/lib/mothership/generated/resources'
import {
  readSandboxResourceScope,
  recordSandboxResourceEffects,
} from '@/lib/mothership/tools/sandbox-resources'

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
  const endpoint = getInternalApiBaseUrl()
  const target = `${endpoint.replace(/\/$/, '')}${path}${url.search}`
  const headers = new Headers(request.headers)
  for (const header of ['host', 'cookie', 'authorization', 'connection', 'transfer-encoding'])
    headers.delete(header)
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
  /** Invoke the public handler unmarked, preserving API-key auth and both external rate limits. */
  const matched = matchV2Route(path)
  if (!matched) return Response.json({ error: 'API route not found' }, { status: 404 })
  const method = request.method === 'HEAD' ? 'GET' : request.method
  const handler = Reflect.get(await matched.load(), method)
  if (typeof handler !== 'function')
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  const dispatch = async () => {
    dispatched = true
    response = await handler(new NextRequest(forwarded), {
      params: Promise.resolve(matched.params),
    })
    if (!(response instanceof Response)) throw new Error('Invalid sandbox API response')
    return response
  }
  try {
    await createResourceEffectTransport(endpoint, dispatch, effects)(forwarded)
  } catch (error) {
    if (!dispatched) response = await dispatch()
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
    effects.map((effect, index) => ({
      ...effect,
      effectId: `${scope.runId}:${scope.toolCallId}:${requestId}:${index}`,
    }))
  )
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}
