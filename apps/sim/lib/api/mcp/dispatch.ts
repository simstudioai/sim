import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { createLogger } from '@sim/logger'
import { CLIENT_INFO_HEADER } from '@sim/utils/client-info'
import { isPlainRecord } from '@sim/utils/object'
import { NextRequest } from 'next/server'
import { callerHeaderNames, getMcpOperation, isReadOperation } from '@/lib/api/mcp/catalog'
import type { V2McpOperationName } from '@/lib/api/mcp/generated/v2-operations'
import { API_KEY_HEADER } from '@/lib/api/server/credential-headers'
import type { V2CredentialHeaders } from '@/lib/api/server/routes/v2-credential-headers'
import {
  type OAuthAccessTokenOptions,
  withOAuthAccessTokenAudience,
} from '@/lib/auth/oauth-access-token'
import { normalizeStringRecord } from '@/lib/core/utils/records'
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
  params?: Record<string, string | number>
  query?: Record<string, string | number | boolean | null>
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
  /** Extra fields for the per-call log line, such as the code-mode run a call belongs to. */
  logMetadata?: Record<string, unknown>
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

/**
 * What a call came to: rejected before it reached the route (a malformed call),
 * the route's JSON answer, or an answer the route gave that cannot be returned
 * (not JSON, or too large). An unreadable answer still means the operation ran.
 */
type McpDispatchOutcome =
  | { rejected: string }
  | { status: number; ok: boolean; text: string }
  | UnreadableAnswer

/** An answer the route gave that cannot be returned, and why. */
interface UnreadableAnswer {
  status: number
  unreadable: string
  tooLarge: boolean
}

/**
 * Explains an unreadable answer to the model. The operation ran either way, so a
 * write is never to be repeated; only a read that came back too large can be
 * retried, asking for less.
 */
export function unreadableMessage(
  operation: V2McpOperationName,
  answer: UnreadableAnswer,
  isRead: boolean
): string {
  const message = `${operation} ran (HTTP ${answer.status}), but its answer cannot be returned. ${answer.unreadable}`
  if (!isRead) return `${message} Do not repeat it; read the resource to see its state.`
  return answer.tooLarge
    ? `${message} Request less, such as a smaller page with limit or cursor.`
    : message
}

/** Reads the route's JSON answer, bounded by {@link MAX_RESULT_BYTES}. */
async function readJsonAnswer(
  operation: V2McpOperationName,
  response: Response
): Promise<McpDispatchOutcome> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!/[/+]json\b/i.test(contentType)) {
    await consumeOrCancelBody(response)
    return {
      status: response.status,
      unreadable: `The answer is ${contentType || 'empty'}; only JSON can be returned over MCP.`,
      tooLarge: false,
    }
  }
  try {
    const text = await readResponseTextWithLimit(response, {
      maxBytes: MAX_RESULT_BYTES,
      label: `${operation} result`,
    })
    return { status: response.status, ok: response.ok, text }
  } catch (error) {
    if (!isPayloadSizeLimitError(error)) throw error
    return {
      status: response.status,
      unreadable: 'The answer is too large to return.',
      tooLarge: true,
    }
  }
}

/**
 * Serves one operation call, from a call tool or `sim.api`, through the v2
 * route that owns the operation.
 *
 * The call becomes the HTTP request the route would receive — same path, query,
 * body, and credential — and the route handles it end to end: authentication,
 * OAuth scope, rate limit, validation, the application use case, and the error
 * envelope. MCP adds no authorization of its own, so no operation can be looser
 * here than over HTTP.
 */
export async function dispatchMcpRequest(
  call: McpOperationCall,
  context: McpDispatchContext
): Promise<McpDispatchOutcome> {
  const startedAt = performance.now()
  const { contract, handler } = getMcpOperation(call.operation)

  const params = normalizeStringRecord(call.params)
  const resolved = resolvePath(contract.path, params)
  if ('error' in resolved) return { rejected: resolved.error }

  const url = new URL(resolved.path, getBaseUrl())
  for (const [name, value] of Object.entries(call.query ?? {})) {
    if (value !== null) url.searchParams.set(name, String(value))
  }

  const hasBody = contract.method !== 'GET' && contract.body !== undefined
  if (!hasBody && call.body !== undefined) {
    return { rejected: `${call.operation} takes no request body. Use params and query instead.` }
  }
  if (isPlainRecord(call.body) && call.body.stream === true) {
    return {
      rejected:
        'Streaming is not supported over MCP. Omit stream to wait for the result, or set async: true and poll getWorkflowRun.',
    }
  }
  const headers = buildHeaders(call, context, hasBody)
  if ('error' in headers) return { rejected: headers.error }

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
    route(request, { params: Promise.resolve(params) })
  )
  logger.info('Sim MCP operation dispatched', {
    operation: call.operation,
    status: response.status,
    durationMs: Math.round(performance.now() - startedAt),
    ...context.logMetadata,
  })
  return readJsonAnswer(call.operation, response)
}

/** {@link dispatchMcpRequest} as a tool result; a v2 error envelope becomes a tool error. */
export async function dispatchMcpOperation(
  call: McpOperationCall,
  context: McpDispatchContext
): Promise<CallToolResult> {
  const outcome = await dispatchMcpRequest(call, context)
  if ('rejected' in outcome) return toolError(outcome.rejected)
  if ('unreadable' in outcome) {
    return toolError(
      unreadableMessage(call.operation, outcome, await isReadOperation(call.operation))
    )
  }
  return outcome.ok ? { content: [{ type: 'text', text: outcome.text }] } : toolError(outcome.text)
}
