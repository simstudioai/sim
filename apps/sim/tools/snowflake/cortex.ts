import { isPlainRecord } from '@sim/utils/object'
import type {
  SnowflakeCortexAnalystAskOutput,
  SnowflakeCortexAnalystAskParams,
  SnowflakeCortexAnalystMessage,
  SnowflakeCortexAnalystVerifiedQuery,
} from '@/tools/snowflake/types'

/** The four mutually exclusive ways the message endpoint accepts a semantic source. */
const SEMANTIC_SOURCE_FIELDS = [
  ['semanticView', 'semantic_view'],
  ['semanticModelFile', 'semantic_model_file'],
  ['semanticModel', 'semantic_model'],
  ['semanticModels', 'semantic_models'],
] as const

/** A block's JSON field arrives parsed, while a direct tool call can deliver the raw string. */
function parseJsonValue(value: unknown, label: string): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    throw new Error(`${label} must be valid JSON`)
  }
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim() !== ''
  return true
}

/**
 * Validates prior conversation turns. Cortex Analyst keeps no state between requests, so a
 * follow-up replays every earlier `user` and `analyst` message in chronological order.
 */
export function parseCortexAnalystHistory(value: unknown): SnowflakeCortexAnalystMessage[] {
  const parsed = parseJsonValue(value, 'History')
  if (parsed === undefined || parsed === null) return []
  if (!Array.isArray(parsed)) {
    throw new Error('History must be a JSON array of previous conversation messages')
  }
  return parsed.map((message, index) => {
    if (
      !isPlainRecord(message) ||
      (message.role !== 'user' && message.role !== 'analyst') ||
      !Array.isArray(message.content)
    ) {
      throw new Error(
        `History message ${index + 1} must have a role of "user" or "analyst" and a content array`
      )
    }
    return { role: message.role, content: message.content as Array<Record<string, unknown>> }
  })
}

/** Validates the multi-model routing list: each entry names one staged file or one view. */
function parseSemanticModels(value: unknown): Array<Record<string, string>> {
  const parsed = parseJsonValue(value, 'Semantic models')
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Semantic models must be a non-empty JSON array')
  }
  return parsed.map((entry, index) => {
    const keys = isPlainRecord(entry) ? Object.keys(entry) : []
    const key = keys[0]
    if (
      keys.length !== 1 ||
      (key !== 'semantic_view' && key !== 'semantic_model_file') ||
      typeof (entry as Record<string, unknown>)[key] !== 'string'
    ) {
      throw new Error(
        `Semantic models entry ${index + 1} must be {"semantic_view": "..."} or {"semantic_model_file": "@..."}`
      )
    }
    const value = ((entry as Record<string, string>)[key] as string).trim()
    if (!value) throw new Error(`Semantic models entry ${index + 1} has an empty ${key}`)
    if (key === 'semantic_model_file') assertStagePath(value)
    return { [key]: value }
  })
}

/** The reference requires a fully qualified stage URL, which always starts with `@`. */
function assertStagePath(value: string): void {
  if (!value.startsWith('@')) {
    throw new Error(
      'Semantic model file must be a stage path starting with @, for example @MY_DB.MY_SCHEMA.MY_STAGE/model.yaml'
    )
  }
}

/** An unquoted identifier, or a double-quoted one with `""` escapes, as Execute SQL accepts. */
const CONTEXT_IDENTIFIER = /^(?:[A-Za-z_][A-Za-z0-9_$]*|"(?:[^"]|"")+")$/

/** Splits a qualified name on the dots outside double-quoted identifiers. */
function splitQualifiedName(name: string): string[] {
  const parts: string[] = []
  let current = ''
  let quoted = false
  for (const char of name) {
    if (char === '"') quoted = !quoted
    if (char === '.' && !quoted) {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }
  parts.push(current)
  return parts
}

/**
 * Resolves an identifier the way Snowflake does: unquoted names are case-insensitive and stored
 * uppercase, while quoted names keep their exact case. Used only to compare two sources.
 */
function canonicalIdentifier(identifier: string): string {
  return identifier.startsWith('"')
    ? identifier.slice(1, -1).replaceAll('""', '"')
    : identifier.toUpperCase()
}

/** Database and schema of a `DB.SCHEMA.VIEW` view name or an `@DB.SCHEMA.STAGE/file` stage path. */
function sourceContext(
  kind: 'semantic_view' | 'semantic_model_file',
  value: string
): { database: string; schema: string } | null {
  const name = kind === 'semantic_view' ? value.trim() : value.trim().slice(1).split('/')[0]
  const parts = splitQualifiedName(name)
  if (parts.length !== 3) return null
  const [database, schema] = parts
  if (!CONTEXT_IDENTIFIER.test(database) || !CONTEXT_IDENTIFIER.test(schema)) return null
  return { database, schema }
}

/** Context of one `semantic_models` entry, or null when it is not fully qualified. */
function modelEntryContext(
  entry: Record<string, string>
): { database: string; schema: string } | null {
  return entry.semantic_view !== undefined
    ? sourceContext('semantic_view', entry.semantic_view)
    : sourceContext('semantic_model_file', entry.semantic_model_file)
}

/**
 * Database and schema to run the generated SQL in. Generated SQL can reference the semantic
 * view unqualified, so it runs in the fully qualified view's (or staged model's) schema.
 *
 * With several sources, the response's `semantic_model_selection.index` names the source
 * Cortex Analyst chose, and the SQL runs in that source's schema. Without a usable index, the
 * context is set only when every source shares one database and schema (compared the way
 * Snowflake resolves identifiers); otherwise the credential's default context applies.
 */
export function cortexAnalystSqlContext(
  params: Pick<
    SnowflakeCortexAnalystAskParams,
    'semanticView' | 'semanticModelFile' | 'semanticModels'
  >,
  selectedIndex?: number | null
): { database?: string; schema?: string } {
  if (hasValue(params.semanticView)) {
    return sourceContext('semantic_view', String(params.semanticView)) ?? {}
  }
  if (hasValue(params.semanticModelFile)) {
    return sourceContext('semantic_model_file', String(params.semanticModelFile)) ?? {}
  }
  if (!hasValue(params.semanticModels)) return {}

  const entries = parseSemanticModels(params.semanticModels)
  if (
    typeof selectedIndex === 'number' &&
    Number.isInteger(selectedIndex) &&
    selectedIndex >= 0 &&
    selectedIndex < entries.length
  ) {
    return modelEntryContext(entries[selectedIndex]) ?? {}
  }

  const contexts = entries.map(modelEntryContext)
  const [first] = contexts
  if (
    !first ||
    contexts.some(
      (context) =>
        !context ||
        canonicalIdentifier(context.database) !== canonicalIdentifier(first.database) ||
        canonicalIdentifier(context.schema) !== canonicalIdentifier(first.schema)
    )
  ) {
    return {}
  }
  return { database: first.database, schema: first.schema }
}

/** The request's user turn, appended after any history. */
export function cortexAnalystUserMessage(question: string): SnowflakeCortexAnalystMessage {
  return { role: 'user', content: [{ type: 'text', text: question }] }
}

/** Builds the message request body. Exactly one semantic source must be supplied. */
export function buildCortexAnalystBody(
  params: SnowflakeCortexAnalystAskParams
): Record<string, unknown> {
  const question = params.question?.trim()
  if (!question) throw new Error('Question is required')

  const provided = SEMANTIC_SOURCE_FIELDS.filter(([param]) => hasValue(params[param]))
  if (provided.length !== 1) {
    throw new Error(
      'Provide exactly one semantic source: a semantic view, a staged semantic model file, an inline semantic model YAML, or a list of semantic models'
    )
  }
  const [param, field] = provided[0]
  if (param === 'semanticModelFile') assertStagePath(String(params.semanticModelFile).trim())
  const value =
    param === 'semanticModels'
      ? parseSemanticModels(params.semanticModels)
      : param === 'semanticModel'
        ? String(params.semanticModel)
        : String(params[param]).trim()

  return {
    messages: [...parseCortexAnalystHistory(params.history), cortexAnalystUserMessage(question)],
    [field]: value,
  }
}

interface CortexAnalystContentPayload {
  type?: string
  text?: string
  statement?: string
  confidence?: {
    verified_query_used?: {
      name?: string
      question?: string
      sql?: string
      verified_at?: number
      verified_by?: string
    } | null
  }
  suggestions?: unknown
}

export interface CortexAnalystResponsePayload {
  request_id?: string
  semantic_model_selection?: {
    index?: number
    identifier?: {
      semantic_model_file?: string
      semantic_view?: string
      inline_semantic_model?: string
    }
  } | null
  message?: { role?: string; content?: CortexAnalystContentPayload[] }
  warnings?: Array<{ message?: string }>
  response_metadata?: {
    model_names?: unknown
    question_category?: string
    cortex_search_retrieval?: unknown
  }
}

function stringArray(value: unknown): string[] {
  if (typeof value === 'string') return value ? [value] : []
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

/**
 * Flattens an analyst message into its interpretation text, SQL, and suggestions. SQL and
 * suggestions are mutually exclusive: suggestions come back only when the question was too
 * ambiguous to generate SQL. The reference names the suggestion content type both
 * `suggestion` and `suggestions`, and types the field as a string while its examples return an
 * array, so every form is read.
 *
 * The analyst turn is echoed into `conversation` so it can be replayed as history on the next
 * ask: text, `sql` statements without their confidence metadata, and suggestion lists (under the
 * `suggestions` type the API's content enum defines), so a follow-up can refer to a suggested
 * question. Snowflake's own Cortex Analyst client replays suggestion blocks the same way.
 *
 * `requestIdHeader` is the `X-Snowflake-Request-Id` response header, which Snowflake's client
 * falls back to when the body carries no `request_id`.
 */
export function mapCortexAnalystResponse(
  data: CortexAnalystResponsePayload,
  sentMessages: SnowflakeCortexAnalystMessage[],
  requestIdHeader?: string | null
): SnowflakeCortexAnalystAskOutput {
  const content = data.message?.content ?? []
  const texts: string[] = []
  let sql: string | null = null
  let verifiedQuery: SnowflakeCortexAnalystVerifiedQuery | null = null
  const suggestions: string[] = []

  for (const block of content) {
    if (block.type === 'text' && block.text) texts.push(block.text)
    if (block.type === 'sql' && block.statement && sql === null) {
      sql = block.statement
      const verified = block.confidence?.verified_query_used
      verifiedQuery = verified
        ? {
            name: verified.name ?? null,
            question: verified.question ?? null,
            sql: verified.sql ?? null,
            verifiedAt: verified.verified_at ?? null,
            verifiedBy: verified.verified_by ?? null,
          }
        : null
    }
    if (block.type === 'suggestions' || block.type === 'suggestion') {
      suggestions.push(...stringArray(block.suggestions))
    }
  }

  const analystMessage: SnowflakeCortexAnalystMessage = {
    role: 'analyst',
    content: content.flatMap((block): Array<Record<string, unknown>> => {
      if (block.type === 'text' && block.text) return [{ type: 'text', text: block.text }]
      if (block.type === 'sql' && block.statement) {
        return [{ type: 'sql', statement: block.statement }]
      }
      if (block.type === 'suggestions' || block.type === 'suggestion') {
        const suggested = stringArray(block.suggestions)
        return suggested.length > 0 ? [{ type: 'suggestions', suggestions: suggested }] : []
      }
      return []
    }),
  }

  const selection = data.semantic_model_selection
  const identifier = selection?.identifier

  return {
    requestId: data.request_id || requestIdHeader || null,
    text: texts.length > 0 ? texts.join('\n\n') : null,
    sql,
    verifiedQuery,
    suggestions,
    warnings: (data.warnings ?? [])
      .map((warning) => warning.message)
      .filter((message): message is string => typeof message === 'string'),
    questionCategory: data.response_metadata?.question_category ?? null,
    modelNames: stringArray(data.response_metadata?.model_names),
    semanticModelSelection: selection
      ? {
          index: typeof selection.index === 'number' ? selection.index : null,
          semanticView: identifier?.semantic_view ?? null,
          semanticModelFile: identifier?.semantic_model_file ?? null,
          inlineSemanticModel: identifier?.inline_semantic_model ?? null,
        }
      : null,
    cortexSearchRetrieval: data.response_metadata?.cortex_search_retrieval ?? null,
    conversation: [...sentMessages, analystMessage],
    execution: null,
  }
}
