import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { createLogger } from '@sim/logger'
import { CLIENT_INFO_HEADER } from '@sim/utils/client-info'
import { isPlainRecord } from '@sim/utils/object'
import { NextRequest } from 'next/server'
import { callerHeaderNames, getMcpOperation } from '@/lib/api/mcp/catalog'
import type { V2McpOperationName } from '@/lib/api/mcp/generated/v2-operations'
import { API_KEY_HEADER } from '@/lib/api/server/credential-headers'
import type { V2CredentialHeaders } from '@/lib/api/server/routes/v2-credential-headers'
import {
  type OAuthAccessTokenOptions,
  withOAuthAccessTokenAudience,
} from '@/lib/auth/oauth-access-token'
import {
  consumeOrCancelBody,
  isPayloadSizeLimitError,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { toolError } from '@/lib/mcp/tool-result'

const logger = createLogger('SimMcpDispatch')

/** Bounds one tool result; list operations page well below this. */
const MAX_RESULT_BYTES = 1024 * 1024

/**
 * Headers the dispatched request inherits from the MCP request: the client
 * address the v2 pre-authentication limit is keyed on, and trace context.
 */
const INHERITED_HEADERS = ['x-forwarded-for', 'traceparent', 'user-agent'] as const

type V2RouteHandler = (
  request: NextRequest,
  context: { params: Promise<Record<string, string>> }
) => Promise<Response>

/** One tool call, as the read and write tools accept it. */
export interface McpOperationCall {
  operation: V2McpOperationName
  params?: Record<string, string>
  query?: Record<string, string | number | boolean>
  body?: unknown
  headers?: Record<string, string>
}

/** What the MCP request established: who is calling, and the audience their token was verified for. */
export interface McpDispatchContext {
  /** The MCP HTTP request the tool call arrived on. */
  inbound: NextRequest
  credential: V2CredentialHeaders
  audience: OAuthAccessTokenOptions
  signal: AbortSignal
}

function isRouteHandler(value: unknown): value is V2RouteHandler {
  return typeof value === 'function'
}

/** `/api/v2/tables/[tableId]` + `{ tableId }` → `/api/v2/tables/t_1`, or an error naming what is wrong. */
function resolvePath(
  template: string,
  params: Record<string, string>
): { path: string } | { error: string } {
  const expected = [...template.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1])
  const unknown = Object.keys(params).filter((name) => !expected.includes(name))
  if (unknown.length > 0) {
    return {
      error: `Unknown path parameter ${unknown.join(', ')}. This operation takes: ${expected.join(', ') || 'none'}.`,
    }
  }
  const missing = expected.filter((name) => !params[name])
  if (missing.length > 0) return { error: `Missing path parameter ${missing.join(', ')}.` }
  const dotSegment = expected.find((name) => params[name] === '.' || params[name] === '..')
  if (dotSegment) return { error: `Path parameter ${dotSegment} cannot be "." or "..".` }
  return {
    path: template.replace(/\[([^\]]+)\]/g, (_, name: string) => encodeURIComponent(params[name])),
  }
}

/** The dispatched request's headers: inherited context, the verified credential, and caller-settable contract headers. */
function buildHeaders(
  call: McpOperationCall,
  context: McpDispatchContext,
  hasBody: boolean
): Headers | { error: string } {
  const headers = new Headers({ accept: 'application/json', [CLIENT_INFO_HEADER]: 'mcp' })
  if (hasBody) headers.set('content-type', 'application/json')
  for (const name of INHERITED_HEADERS) {
    const value = context.inbound.headers.get(name)
    if (value) headers.set(name, value)
  }
  if (context.credential.apiKey) headers.set(API_KEY_HEADER, context.credential.apiKey)
  if (context.credential.bearer) headers.set('authorization', `Bearer ${context.credential.bearer}`)

  const allowed = callerHeaderNames(call.operation)
  for (const [name, value] of Object.entries(call.headers ?? {})) {
    if (!allowed.includes(name.toLowerCase())) {
      return {
        error: `Header ${name} cannot be set on ${call.operation}. Settable headers: ${allowed.join(', ') || 'none'}.`,
      }
    }
    headers.set(name, value)
  }
  return headers
}

/** Returns the route's JSON answer as tool content; a v2 error envelope becomes a tool error. */
async function toToolResult(
  operation: V2McpOperationName,
  response: Response
): Promise<CallToolResult> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!/[/+]json\b/i.test(contentType)) {
    await consumeOrCancelBody(response)
    return toolError(
      `${operation} answered with ${contentType || 'an empty body'} (HTTP ${response.status}). Only JSON responses can be returned over MCP.`
    )
  }
  let text: string
  try {
    text = await readResponseTextWithLimit(response, {
      maxBytes: MAX_RESULT_BYTES,
      label: `${operation} result`,
    })
  } catch (error) {
    if (!isPayloadSizeLimitError(error)) throw error
    return toolError('Result is too large. Request a smaller page with limit or cursor.')
  }
  return response.ok ? { content: [{ type: 'text', text }] } : toolError(text)
}

/**
 * Serves a tool call through the v2 route that owns the operation.
 *
 * The call becomes the HTTP request the route would receive — same path, query,
 * body, and credential — and the route handles it end to end: authentication,
 * OAuth scope, rate limit, validation, the application use case, and the error
 * envelope. MCP adds no authorization of its own, so no operation can be looser
 * here than over HTTP.
 */
export async function dispatchMcpOperation(
  call: McpOperationCall,
  context: McpDispatchContext
): Promise<CallToolResult> {
  const startedAt = performance.now()
  const { contract, handler } = getMcpOperation(call.operation)

  const resolved = resolvePath(contract.path, call.params ?? {})
  if ('error' in resolved) return toolError(resolved.error)

  const url = new URL(resolved.path, getBaseUrl())
  for (const [name, value] of Object.entries(call.query ?? {})) {
    url.searchParams.set(name, String(value))
  }

  const hasBody = contract.method !== 'GET' && contract.body !== undefined
  if (!hasBody && call.body !== undefined) {
    return toolError(`${call.operation} takes no request body. Use params and query instead.`)
  }
  if (isPlainRecord(call.body) && call.body.stream === true) {
    return toolError(
      'Streaming is not supported over MCP. Omit stream to wait for the result, or set async: true and poll getWorkflowRun.'
    )
  }
  const headers = buildHeaders(call, context, hasBody)
  if ('error' in headers) return toolError(headers.error)

  const route = await handler()
  if (!isRouteHandler(route)) {
    throw new Error(`${call.operation} has no ${contract.method} handler at ${contract.path}`)
  }

  const request = new NextRequest(url, {
    method: contract.method,
    headers,
    body: hasBody ? JSON.stringify(call.body ?? {}) : undefined,
    signal: context.signal,
  })
  const response = await withOAuthAccessTokenAudience(context.audience, () =>
    route(request, { params: Promise.resolve(call.params ?? {}) })
  )
  logger.info('Sim MCP operation dispatched', {
    operation: call.operation,
    status: response.status,
    durationMs: Math.round(performance.now() - startedAt),
  })
  return toToolResult(call.operation, response)
}
