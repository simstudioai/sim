import { generateId } from '@sim/utils/id'
import { truncate } from '@sim/utils/string'
import type { LangsmithRunPayload } from '@/tools/langsmith/types'

/**
 * Versioned LangSmith API base.
 *
 * The published OpenAPI spec (https://api.smith.langchain.com/openapi.json)
 * declares two surfaces: ~303 `/api/v1/*` paths and ~38 `/api/v2/*` paths
 * (run/trace/thread query endpoints plus the sandbox API). Every endpoint this
 * integration calls is still declared under `/api/v1`, so the base stays v1 —
 * but `/api/v2` exists and is where the deprecated run reads move to. See the
 * migration note on {@link file://./get_run.ts}.
 */
export const LANGSMITH_API_BASE = 'https://api.smith.langchain.com/api/v1'

/** Every JSON type LangSmith's `FeedbackCreateSchema.value` accepts. */
export type LangsmithFeedbackValue = string | number | boolean | Record<string, unknown> | null

/**
 * Coerces a feedback `value` typed into a free-text field into the JSON type
 * LangSmith actually stores.
 *
 * `FeedbackCreateSchema.value` accepts `number | integer | boolean | string |
 * object | null`, but both surfaces hand this tool a string — the block renders
 * a `short-input`, and the model tool schema declares `type: 'string'` because
 * `buildParameterSchema` collapses `'json'` to `{"type":"object"}` and so has
 * no way to express that union. Without this coercion a user or model asking
 * for the numeric value `1` or the boolean `true` would post the strings `"1"`
 * / `"true"` and get a differently-typed row back. Anything that is not valid
 * JSON — the common categorical case, `good` — stays the string it was typed
 * as.
 *
 * Three inputs are deliberately *not* taken at face value:
 *
 * - A bare `null` yields `undefined`, so the field is dropped rather than
 *   posted. `filterUndefined` strips only `undefined`, so a categorical label
 *   of `null` — or a template that rendered an unset variable — would
 *   otherwise silently record null-valued feedback, which is indistinguishable
 *   from feedback whose value was never set. No text field can express "store
 *   JSON null" separately from "left blank", so the blank reading wins.
 * - A number that does not survive `JSON.parse` → `JSON.stringify` unchanged
 *   stays a string. `"1.0"` would become `1`, losing the exact label the user
 *   typed, and an id longer than 2^53 (say a 20-digit ticket number) would
 *   silently lose its low-order digits. A leading-zero label like `"007"` is
 *   caught one step earlier — leading zeros are invalid JSON, so `JSON.parse`
 *   throws and the `catch` returns the original string.
 * - An array literal stays a string, since the schema has no array member.
 *
 * Not idempotent, and deliberately called exactly once — from
 * {@link file://./create_feedback.ts}'s `request.body`, which every surface
 * (block, model tool call, Copilot) routes through. Applying it twice would
 * unwrap a JSON-quoted string a second time, which is precisely how a user
 * forces a categorical label that looks scalar: `"1"` would become the number
 * `1`, `"true"` the boolean `true`, and `"null"` would be dropped entirely.
 */
export const parseLangsmithFeedbackValue = (value: unknown): LangsmithFeedbackValue | undefined => {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') return value as LangsmithFeedbackValue
  const trimmed = value.trim()
  if (trimmed === '') return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return value
  }

  if (parsed === null) return undefined
  if (Array.isArray(parsed)) return value
  if (typeof parsed === 'number' && JSON.stringify(parsed) !== trimmed) return value
  return parsed as LangsmithFeedbackValue
}

/** Ellipsis appended to an upstream error body that had to be cut short. */
const ERROR_TEXT_SUFFIX = '...'

/**
 * Upper bound on the total number of characters an upstream error body may
 * contribute to a thrown message, ellipsis included. An HTML error page or a
 * large payload echo would otherwise land whole in the error string, the
 * execution log, and the model's context.
 */
export const ERROR_TEXT_MAX_LENGTH = 500

/**
 * Caps an upstream error body at {@link ERROR_TEXT_MAX_LENGTH} characters in
 * total. `truncate` appends its suffix *after* slicing, so the slice length is
 * reduced by the suffix length to keep the advertised bound real.
 */
export const truncateLangsmithErrorText = (errorText: string): string =>
  truncate(errorText, ERROR_TEXT_MAX_LENGTH - ERROR_TEXT_SUFFIX.length, ERROR_TEXT_SUFFIX)

/**
 * Every field the LangSmith run-ingest schema accepts. Request bodies are built
 * by selecting these keys explicitly rather than by spreading the caller's
 * params, so a credential (or any future secret-bearing param) can never reach
 * the wire: a field that is not listed here is not sent, by construction.
 */
const RUN_PAYLOAD_FIELDS = [
  'id',
  'name',
  'run_type',
  'start_time',
  'end_time',
  'inputs',
  'outputs',
  'extra',
  'tags',
  'parent_run_id',
  'trace_id',
  'session_id',
  'session_name',
  'status',
  'error',
  'dotted_order',
  'events',
] as const satisfies readonly (keyof LangsmithRunPayload)[]

interface NormalizedRunPayload {
  payload: LangsmithRunPayload
  runId: string
}

const pickRunPayloadFields = (run: LangsmithRunPayload): LangsmithRunPayload => {
  const picked: Partial<LangsmithRunPayload> = {}
  for (const field of RUN_PAYLOAD_FIELDS) {
    if (run[field] !== undefined) Object.assign(picked, { [field]: run[field] })
  }
  return picked as LangsmithRunPayload
}

const toCompactTimestamp = (startTime?: string): string => {
  const parsed = startTime ? new Date(startTime) : new Date()
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed
  const pad = (value: number, length: number) => value.toString().padStart(length, '0')
  const year = date.getUTCFullYear()
  const month = pad(date.getUTCMonth() + 1, 2)
  const day = pad(date.getUTCDate(), 2)
  const hours = pad(date.getUTCHours(), 2)
  const minutes = pad(date.getUTCMinutes(), 2)
  const seconds = pad(date.getUTCSeconds(), 2)
  const micros = pad(date.getUTCMilliseconds() * 1000, 6)
  return `${year}${month}${day}T${hours}${minutes}${seconds}${micros}`
}

/**
 * Memoizes normalization on the caller's own params object.
 *
 * `request.body()` and `transformResponse` are separate closures that each
 * normalize the same run, and normalization mints a random id when the caller
 * supplied none. Without this cache the id reported to the workflow is not the
 * id that was sent, so every downstream `langsmith_update_run` /
 * `langsmith_create_feedback` wired to it targets a run that does not exist.
 *
 * Keying on the object identity — rather than on module-level mutable state —
 * keeps concurrent executions independent: each has its own params object, and
 * entries are collected with it.
 */
const normalizedRunCache = new WeakMap<LangsmithRunPayload, NormalizedRunPayload>()

/**
 * Builds the ingest body for a NEW run, filling in the identity and trace
 * fields LangSmith requires when the caller left them blank. Idempotent per
 * params object: repeated calls return the id that was actually sent.
 */
export const normalizeLangsmithRunPayload = (run: LangsmithRunPayload): NormalizedRunPayload => {
  const cached = normalizedRunCache.get(run)
  if (cached) return cached

  const runId = run.id ?? generateId()
  const traceId = run.trace_id ?? runId
  const startTime = run.start_time ?? new Date().toISOString()
  const dottedOrder = run.dotted_order ?? `${toCompactTimestamp(startTime)}Z${runId}`

  const normalized: NormalizedRunPayload = {
    runId,
    payload: {
      ...pickRunPayloadFields(run),
      id: runId,
      trace_id: traceId,
      start_time: startTime,
      dotted_order: dottedOrder,
    },
  }

  normalizedRunCache.set(run, normalized)
  return normalized
}

/**
 * Builds the ingest body for a PATCH of an existing run.
 *
 * Unlike {@link normalizeLangsmithRunPayload} this fabricates nothing: a patch
 * addresses a run that already exists, so minting an `id` would patch nothing
 * and force-writing `trace_id`/`dotted_order` would overwrite the run's real
 * position in its trace. LangSmith's own batch example builds patches by
 * spreading the original run and adding only `end_time`/`outputs`.
 *
 * @throws when the entry carries no `id`. A patch without an id is a caller
 * error with no correct interpretation; dropping it would silently discard the
 * caller's update and still report success.
 */
export const prepareLangsmithPatchPayload = (run: LangsmithRunPayload): NormalizedRunPayload => {
  const runId = run.id
  if (!runId) {
    throw new Error(
      'LangSmith patch entries must carry the id of an existing run. Provide `id` on every entry in `patch`.'
    )
  }

  return { runId, payload: pickRunPayloadFields(run) }
}
