import { validateDatabricksWorkspaceHost } from '@/lib/core/security/input-validation'
import type {
  DatabricksGenieAgentItem,
  DatabricksGenieMessage,
  DatabricksGenieSpace,
  DatabricksStatementResult,
} from '@/tools/databricks/types'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

/** Message states after which Genie will not change a chat-mode message further. */
export const GENIE_TERMINAL_STATUSES = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'QUERY_RESULT_EXPIRED',
])

/** Retries rate-limited and transient reads; Genie enforces per-workspace throughput limits. */
export const GENIE_READ_RETRY = {
  enabled: true,
  maxRetries: 3,
  retryIdempotentOnly: true,
} as const

/** Workspace credentials every Databricks tool takes. */
export const DATABRICKS_AUTH_PARAMS = {
  host: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Databricks workspace host (e.g., dbc-abc123.cloud.databricks.com)',
  },
  apiKey: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Databricks Personal Access Token',
  },
} as const satisfies ToolConfig['params']

/** Workspace credentials plus the Genie space a tool addresses. */
export const GENIE_SPACE_PARAMS = {
  ...DATABRICKS_AUTH_PARAMS,
  spaceId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'The ID of the Genie space',
  },
} as const satisfies ToolConfig['params']

/** Parameters addressing one message in a Genie conversation. */
export const GENIE_MESSAGE_PARAMS = {
  ...GENIE_SPACE_PARAMS,
  conversationId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'The ID of the Genie conversation',
  },
  messageId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'The ID of the Genie message',
  },
} as const satisfies ToolConfig['params']

/**
 * Builds an absolute Databricks REST URL, refusing any host outside the Databricks workspace
 * domains so the access token is only ever sent to Databricks. The host may carry a scheme or
 * trailing slash; an `http://` scheme is upgraded to HTTPS as before, not rejected.
 */
export function databricksUrl(host: string, path: string): string {
  const result = validateDatabricksWorkspaceHost(host.trim().replace(/^http:\/\//i, ''), 'host')
  if (!result.isValid || !result.sanitized) {
    throw new Error(result.error || 'Invalid Databricks workspace host')
  }
  return `${result.sanitized}${path}`
}

/** Path of a Genie space: `/api/2.0/genie/spaces/{space_id}`. */
export function genieSpacePath(spaceId: string): string {
  return `/api/2.0/genie/spaces/${safeUrlPathSegment(spaceId, 'spaceId')}`
}

/** Path of a conversation within a Genie space. */
export function genieConversationPath(spaceId: string, conversationId: string): string {
  return `${genieSpacePath(spaceId)}/conversations/${safeUrlPathSegment(conversationId, 'conversationId')}`
}

/** Path of a message within a Genie conversation. */
export function genieMessagePath(params: {
  spaceId: string
  conversationId: string
  messageId: string
}): string {
  return `${genieConversationPath(params.spaceId, params.conversationId)}/messages/${safeUrlPathSegment(params.messageId, 'messageId')}`
}

/** Path of an attachment on a Genie message. */
export function genieAttachmentPath(params: {
  spaceId: string
  conversationId: string
  messageId: string
  attachmentId: string
}): string {
  return `${genieMessagePath(params)}/attachments/${safeUrlPathSegment(params.attachmentId, 'attachmentId')}`
}

/** Reads the error message from a Databricks REST error body (`{ error_code, message }`). */
export function databricksErrorMessage(data: unknown, fallback: string): string {
  const body = data as { message?: string; error?: { message?: string } } | null
  return body?.message || body?.error?.message || fallback
}

/** Reads a Databricks error body that may be empty or non-JSON. */
export async function readDatabricksError(response: Response, fallback: string): Promise<string> {
  const text = await response.text()
  try {
    return databricksErrorMessage(JSON.parse(text), text || fallback)
  } catch {
    return text || fallback
  }
}

interface GenieAttachmentPayload {
  attachment_id?: string
  text?: { content?: string; purpose?: string }
  query?: {
    title?: string
    query?: string
    description?: string
    statement_id?: string
    query_result_metadata?: { row_count?: number; is_truncated?: boolean }
    thoughts?: Array<{ thought_type?: string; content?: string }>
  }
  suggested_questions?: { questions?: string[] }
  viz?: { title?: string; query_attachment_id?: string }
}

export interface GenieMessagePayload {
  conversation_id?: string
  message_id?: string
  id?: string
  content?: string
  status?: string
  created_timestamp?: number
  attachments?: GenieAttachmentPayload[] | null
  error?: { error?: string; type?: string } | null
}

/**
 * Flattens a Genie message into its answer, generated SQL, visualizations, and follow-ups. A
 * completed message can carry both a clarifying question and the final answer as text
 * attachments, told apart by `purpose`: the `TEXT_ATTACHMENT_PURPOSE_ANSWER` text is the answer,
 * falling back to the first text without a purpose.
 */
export function mapGenieMessage(message: GenieMessagePayload): DatabricksGenieMessage {
  let answer: string | null = null
  let unlabeledText: string | null = null
  let followUpQuestion: string | null = null
  let queryAttachment: GenieAttachmentPayload | null = null
  const suggestedQuestions: string[] = []
  const visualizations: DatabricksGenieMessage['visualizations'] = []

  for (const attachment of message.attachments ?? []) {
    const text = attachment.text?.content
    if (text) {
      const purpose = attachment.text?.purpose
      if (purpose === 'FOLLOW_UP_QUESTION') followUpQuestion ??= text
      else if (purpose === 'TEXT_ATTACHMENT_PURPOSE_ANSWER') answer ??= text
      else unlabeledText ??= text
    }
    if (attachment.query && !queryAttachment) queryAttachment = attachment
    suggestedQuestions.push(...(attachment.suggested_questions?.questions ?? []))
    if (attachment.viz) {
      visualizations.push({
        attachmentId: attachment.attachment_id ?? '',
        title: attachment.viz.title ?? null,
        queryAttachmentId: attachment.viz.query_attachment_id ?? null,
      })
    }
  }

  const query = queryAttachment?.query
  return {
    conversationId: message.conversation_id ?? '',
    messageId: message.message_id ?? message.id ?? '',
    status: message.status ?? 'UNKNOWN',
    content: message.content ?? '',
    answer: answer ?? unlabeledText,
    followUpQuestion,
    queryTitle: query?.title ?? null,
    sql: query?.query ?? null,
    queryDescription: query?.description ?? null,
    queryAttachmentId: queryAttachment?.attachment_id ?? null,
    statementId: query?.statement_id ?? null,
    rowCount: query?.query_result_metadata?.row_count ?? null,
    thoughts: (query?.thoughts ?? []).map((thought) => ({
      type: thought.thought_type ?? null,
      content: thought.content ?? '',
    })),
    suggestedQuestions,
    visualizations,
    error: message.error?.error ?? null,
    errorType: message.error?.type ?? null,
    createdTimestamp: message.created_timestamp ?? null,
  }
}

export interface StatementResponsePayload {
  statement_id?: string
  status?: { state?: string; error?: { message?: string; error_code?: string } }
  manifest?: {
    schema?: { columns?: Array<{ name?: string; position?: number; type_name?: string }> }
    total_row_count?: number
    truncated?: boolean
  }
  result?: { data_array?: Array<Array<string | null>> }
}

/**
 * Maps the SQL Statement Execution response embedded in Genie query results. Throws when the
 * statement itself failed, since its rows are then absent.
 */
export function mapStatementResult(
  statement: StatementResponsePayload | undefined
): DatabricksStatementResult {
  if (statement?.status?.state === 'FAILED') {
    throw new Error(
      statement.status.error?.message ||
        `Genie query execution failed: ${statement.status.error?.error_code ?? 'UNKNOWN'}`
    )
  }
  return {
    statementId: statement?.statement_id ?? '',
    status: statement?.status?.state ?? 'UNKNOWN',
    columns:
      statement?.manifest?.schema?.columns?.map((col) => ({
        name: col.name ?? '',
        position: col.position ?? 0,
        typeName: col.type_name ?? '',
      })) ?? null,
    data: statement?.result?.data_array ?? null,
    totalRows: statement?.manifest?.total_row_count ?? null,
    truncated: statement?.manifest?.truncated ?? false,
  }
}

interface GenieSpacePayload {
  space_id?: string
  title?: string
  description?: string
  warehouse_id?: string
  parent_path?: string
  create_time?: string
  update_time?: string
}

/** Maps a Genie space, leaving out the `serialized_space` export. */
export function mapGenieSpace(space: GenieSpacePayload): DatabricksGenieSpace {
  return {
    spaceId: space.space_id ?? '',
    title: space.title ?? '',
    description: space.description ?? null,
    warehouseId: space.warehouse_id ?? null,
    parentPath: space.parent_path ?? null,
    createTime: space.create_time ?? null,
    updateTime: space.update_time ?? null,
  }
}

/** Parameters addressing a query attachment; Get Query Result and Execute Query share them. */
export const GENIE_QUERY_ATTACHMENT_PARAMS = {
  ...GENIE_MESSAGE_PARAMS,
  attachmentId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'The query attachment ID (queryAttachmentId from Ask Genie or Get Genie Message)',
  },
} as const satisfies ToolConfig['params']

/** Path of a Genie agent (agent mode addresses the Genie space by its ID). */
export function genieAgentPath(spaceId: string): string {
  return `/api/2.0/genie/agents/${safeUrlPathSegment(spaceId, 'spaceId')}`
}

interface GenieAgentItemPayload {
  type?: string
  id?: string
  status?: string
  role?: string
  content?: Array<{ type?: string; text?: string }>
  call_id?: string
  name?: string
  arguments?: string
  output?: string
}

/**
 * Maps an agent-mode output item. Items are polymorphic on `type`: `message` (user question,
 * assistant report, or system error), `reasoning`, `function_call` (an `execute_sql` call with
 * JSON-string arguments), and `function_call_output` (query title plus a Markdown table).
 */
export function mapGenieAgentItem(item: GenieAgentItemPayload): DatabricksGenieAgentItem {
  const text = (item.content ?? [])
    .map((part) => part.text)
    .filter((part): part is string => Boolean(part))
    .join('\n\n')
  return {
    type: item.type ?? 'unknown',
    id: item.id ?? '',
    status: item.status ?? null,
    role: item.role ?? null,
    text: text || null,
    callId: item.call_id ?? null,
    name: item.name ?? null,
    arguments: item.arguments ?? null,
    output: item.output ?? null,
  }
}

/** Reads the `title` and `sql` an agent passed to its `execute_sql` function call. */
export function parseGenieAgentQuery(item: DatabricksGenieAgentItem): {
  callId: string
  title: string | null
  sql: string | null
} {
  let args: { title?: unknown; sql?: unknown } = {}
  try {
    args = JSON.parse(item.arguments ?? '{}')
  } catch {
    /** Malformed arguments leave title and sql unset rather than failing the response. */
  }
  return {
    callId: item.callId ?? item.id,
    title: typeof args.title === 'string' ? args.title : null,
    sql: typeof args.sql === 'string' ? args.sql : null,
  }
}

export interface GenieAgentResponsePayload {
  id?: string
  status?: string
  output?: GenieAgentItemPayload[]
  conversation_id?: string
  created_at?: number
  error?: unknown
}

const GENIE_AGENT_TERMINAL_EVENTS = new Set(['response.completed', 'response.failed'])

/** Field names the SSE spec defines; any other line is ignored by a compliant parser. */
const SSE_FIELDS = new Set(['event', 'data', 'id', 'retry'])

/**
 * Parses an agent-mode Server-Sent Events body per the SSE spec: an event's `data:` lines join
 * with newlines and dispatch on a blank line. Only the `response.created` and terminal events are
 * JSON-parsed; the incremental `response.output_item.*` events are skipped because the terminal
 * event carries the final response with every output item.
 */
export function parseGenieAgentStream(body: string): {
  created: GenieAgentResponsePayload | null
  final: GenieAgentResponsePayload | null
} {
  let created: GenieAgentResponsePayload | null = null
  let final: GenieAgentResponsePayload | null = null
  let eventName = ''
  let dataLines: string[] = []

  const dispatch = () => {
    const name = eventName
    const data = dataLines.join('\n')
    eventName = ''
    dataLines = []
    if (!data) return
    if (name && name !== 'response.created' && !GENIE_AGENT_TERMINAL_EVENTS.has(name)) return

    let payload: { type?: string; response?: GenieAgentResponsePayload }
    try {
      payload = JSON.parse(data)
    } catch {
      return
    }
    const type = payload.type ?? name
    if (type === 'response.created') created = payload.response ?? null
    if (GENIE_AGENT_TERMINAL_EVENTS.has(type)) final = payload.response ?? null
  }

  for (const line of body.split(/\r\n|\r|\n/)) {
    if (line === '') {
      dispatch()
      continue
    }
    if (line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    if (!SSE_FIELDS.has(field)) {
      /**
       * The API reference renders events as a bare `data:` line followed by unprefixed,
       * pretty-printed JSON. A spec-compliant stream never contains unknown-field lines, so
       * keeping them as data only changes how that documented form parses.
       */
      if (dataLines.length > 0) dataLines.push(line)
      continue
    }
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') eventName = value
    else if (field === 'data') dataLines.push(value)
  }
  dispatch()

  return { created, final }
}

/** Reads the message from an agent-mode response `error` object. */
export function genieAgentErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  const message = (error as { message?: unknown } | null)?.message
  if (typeof message === 'string' && message) return message
  return error ? JSON.stringify(error) : 'Genie agent response failed'
}
