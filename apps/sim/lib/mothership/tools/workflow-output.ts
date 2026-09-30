import { isPlainRecord, isRecordLike } from '@sim/utils/object'
import {
  MAX_CONTENT_NODES,
  MAX_MODEL_CONTENT_BYTES,
  measureModelContent,
} from '@/executor/utils/resolved-secret-content-projection'

/** Shared presentation for server execution and trusted client execution restoration. */
function presentWorkflowLogs(logs: unknown, select?: string[]): Record<string, unknown> {
  return select?.length
    ? { selected: selectFromLogs(select, Array.isArray(logs) ? logs : []), logsOmitted: true }
    : { logs }
}

/**
 * The model-facing log fields for one run, built from raw logs before secret projection so both the
 * server handler and browser-run restoration present the same bounded shape: a `select` resolves
 * against the full logs and replaces them, otherwise the echoed logs are bounded by
 * {@link compactBlockLogOutputs}.
 */
export function presentWorkflowLogsForModel(
  logs: unknown,
  executionId: string | undefined,
  select?: string[]
): Record<string, unknown> {
  return presentWorkflowLogs(
    select?.length ? logs : compactBlockLogOutputs(logs, executionId),
    select
  )
}

/** The executor's block-name rule: lowercase, whitespace and dots removed. */
function normalizeSelectorHead(value: string): string {
  return value.toLowerCase().replace(/[\s.]+/g, '')
}

/**
 * Resolves `blockName.path` selectors against the run's block logs (the last log per block
 * wins, so loop iterations settle on final state) — names or ids for the head, dotted
 * paths into that block's output. An unresolved selector is reported, never thrown.
 */
function selectFromLogs(selectors: string[], logs: unknown[]): Record<string, unknown> {
  const byHead = new Map<string, Record<string, unknown>>()
  for (const entry of logs) {
    if (!isRecordLike(entry)) continue
    const log = entry as Record<string, unknown>
    const output = isRecordLike(log.output) ? (log.output as Record<string, unknown>) : undefined
    if (!output) continue
    if (typeof log.blockId === 'string') byHead.set(log.blockId, output)
    if (typeof log.blockName === 'string') byHead.set(normalizeSelectorHead(log.blockName), output)
  }
  const selected: Record<string, unknown> = {}
  for (const selector of selectors) {
    const [head = '', ...path] = selector.split('.')
    const base = byHead.get(head) ?? byHead.get(normalizeSelectorHead(head))
    if (!base) {
      selected[selector] = { unresolved: `no executed block named "${head}"` }
      continue
    }
    let value: unknown = base
    for (const segment of path) {
      value = isRecordLike(value) ? (value as Record<string, unknown>)[segment] : undefined
    }
    selected[selector] =
      value === undefined ? { unresolved: `no "${path.join('.')}" on ${head}` } : value
  }
  return selected
}

/** Above this a Function block's `input.code` is echoed upstream JSON, not code worth reading. */
const LOG_CODE_INPUT_MAX_CHARS = 240
/** Any other echoed input string over this is data the caller already has, or can fetch. */
const LOG_INPUT_STRING_MAX_CHARS = 2_000
const LOG_INPUT_KEEP_CHARS = 200

/**
 * Compacts the block inputs echoed back in `logs`. A Function block's `input.code` embeds the
 * fully serialized upstream rows, so a seven-block run repeated the same rows several times
 * across ~14k chars of tool result. Outputs are bounded separately by
 * {@link compactBlockLogOutputs}, and the input stays inspectable with
 * `logs get <executionId> --trace`.
 */
export function compactBlockLogInputs(logs: unknown, executionId: string | undefined): unknown {
  if (!Array.isArray(logs)) return logs
  const reference = executionId ?? '<executionId>'
  return logs.map((entry) => {
    if (!isPlainRecord(entry) || !isPlainRecord(entry.input)) return entry
    const input: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(entry.input)) {
      const limit = key === 'code' ? LOG_CODE_INPUT_MAX_CHARS : LOG_INPUT_STRING_MAX_CHARS
      input[key] =
        typeof value === 'string' && value.length > limit
          ? `${value.slice(0, LOG_INPUT_KEEP_CHARS)} …[${value.length} chars, see logs get ${reference} --trace]`
          : value
    }
    return { ...entry, input }
  })
}

/**
 * Budgets for the block outputs echoed back in `logs`, a quarter of each cap the model-facing
 * projection enforces on the whole result. Reaching either cap withholds everything, including
 * the final output and error the run was for; those are never compacted and share the remaining
 * three quarters with the rest of the envelope. The value budget usually binds first: row-shaped
 * outputs reach the projection's traversal cap long before its byte cap.
 */
const LOG_OUTPUT_VALUE_BUDGET = Math.floor(MAX_CONTENT_NODES / 4)
const LOG_OUTPUT_BYTE_BUDGET = Math.floor(MAX_MODEL_CONTENT_BYTES / 4)

interface MeasuredLogOutput {
  index: number
  entry: Record<string, unknown>
  values: number
  bytes: number
  /** What the pointer reports: exact, past the projection's cap, or unencodable. */
  label: string
}

/**
 * Replaces the bulkiest block outputs in `logs` with a pointer once they exceed the budgets
 * above, largest first, so the rest of the run still reaches the model.
 *
 * The pointer names only the value count: bytes are measured before secret projection, so they
 * would disclose a secret's length. It says "inspect" rather than promising the full value, since
 * the stored trace can itself be summarized.
 */
function compactBlockLogOutputs(logs: unknown, executionId: string | undefined): unknown {
  if (!Array.isArray(logs)) return logs
  const reference = executionId ?? '<executionId>'
  const measured: MeasuredLogOutput[] = []
  let values = 0
  let bytes = 0
  for (const [index, entry] of logs.entries()) {
    if (!isPlainRecord(entry) || entry.output === undefined) continue
    const measure = measureModelContent(entry.output)
    const exact = measure?.bytes !== undefined
    const size = {
      values: exact ? measure.values : MAX_CONTENT_NODES + 1,
      bytes: measure?.bytes ?? MAX_MODEL_CONTENT_BYTES + 1,
    }
    const label = !measure
      ? 'output omitted'
      : `output omitted: ${exact ? measure.values : `over ${MAX_CONTENT_NODES}`} values`
    measured.push({ index, entry, ...size, label })
    values += size.values
    bytes += size.bytes
  }
  if (values <= LOG_OUTPUT_VALUE_BUDGET && bytes <= LOG_OUTPUT_BYTE_BUDGET) return logs

  measured.sort((left, right) => right.values - left.values || right.bytes - left.bytes)
  const compacted = [...logs]
  for (const item of measured) {
    if (values <= LOG_OUTPUT_VALUE_BUDGET && bytes <= LOG_OUTPUT_BYTE_BUDGET) break
    compacted[item.index] = {
      ...item.entry,
      output: `…[${item.label}; inspect with logs get ${reference} --trace]`,
    }
    values -= item.values
    bytes -= item.bytes
  }
  return compacted
}
