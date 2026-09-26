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

const UNQUOTED_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/

/**
 * Database and schema to run the generated SQL in, read from a fully qualified semantic view
 * (`DB.SCHEMA.VIEW`) or stage path (`@DB.SCHEMA.STAGE/file.yaml`). Generated SQL can reference
 * the semantic view unqualified, so it has to run in that view's schema. Quoted identifiers are
 * left to the credential's default context rather than re-quoted.
 */
export function cortexAnalystSqlContext(
  params: Pick<SnowflakeCortexAnalystAskParams, 'semanticView' | 'semanticModelFile'>
): { database?: string; schema?: string } {
  const name = hasValue(params.semanticView)
    ? String(params.semanticView).trim()
    : hasValue(params.semanticModelFile)
      ? String(params.semanticModelFile).trim().slice(1).split('/')[0]
      : ''
  const parts = name.split('.')
  if (parts.length !== 3 || !parts.every((part) => UNQUOTED_IDENTIFIER.test(part))) return {}
  return { database: parts[0], schema: parts[1] }
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
  semantic_model_selection?: unknown
  message?: { role?: string; content?: CortexAnalystContentPayload[] }
  warnings?: Array<{ message?: string }>
  response_metadata?: { model_names?: unknown; question_category?: string }
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
 * The analyst turn is echoed into `conversation` in the documented request shape (text blocks
 * and `sql` statements only), so it can be replayed as history on the next ask.
 */
export function mapCortexAnalystResponse(
  data: CortexAnalystResponsePayload,
  sentMessages: SnowflakeCortexAnalystMessage[]
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
      return []
    }),
  }

  return {
    requestId: data.request_id ?? null,
    text: texts.length > 0 ? texts.join('\n\n') : null,
    sql,
    verifiedQuery,
    suggestions,
    warnings: (data.warnings ?? [])
      .map((warning) => warning.message)
      .filter((message): message is string => typeof message === 'string'),
    questionCategory: data.response_metadata?.question_category ?? null,
    modelNames: stringArray(data.response_metadata?.model_names),
    semanticModelSelection: data.semantic_model_selection ?? null,
    conversation: [...sentMessages, analystMessage],
    execution: null,
  }
}
