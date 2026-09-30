import { isPlainRecord, isRecordLike } from '@sim/utils/object'
import { copilotProjectionWalksContent } from '@/lib/mothership/request/tools/resolved-secret-result'
import {
  MAX_CONTENT_NODES,
  MAX_MODEL_CONTENT_BYTES,
  measureModelContent,
} from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

/** Shared presentation for server execution and trusted client execution restoration. */
function presentWorkflowLogs(logs: unknown, select?: string[]): Record<string, unknown> {
  return select?.length
    ? { selected: selectFromLogs(select, Array.isArray(logs) ? logs : []), logsOmitted: true }
    : { logs }
}

/**
 * The model-facing log fields for one run, built from raw logs before secret projection so both the
 * server handler and browser-run restoration present the same shape: a `select` resolves against
 * the full logs and replaces them, otherwise the echoed logs have their inputs truncated. Their
 * outputs are bounded only when `registry` makes the projection walk the result, since only then
 * can its value or depth cap withhold the whole run; otherwise they cross in full.
 */
export function presentWorkflowLogsForModel(
  logs: unknown,
  executionId: string | undefined,
  registry: ResolvedSecretTraceRegistry | undefined,
  select?: string[]
): Record<string, unknown> {
  if (select?.length) return presentWorkflowLogs(logs, select)
  const compacted = compactBlockLogInputs(logs, executionId)
  return presentWorkflowLogs(
    copilotProjectionWalksContent(registry)
      ? compactBlockLogOutputs(compacted, executionId)
      : compacted
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

/**
 * Compacts the block inputs echoed back in `logs`. A Function block's `input.code` embeds the
 * fully serialized upstream rows, so a seven-block run repeated the same rows several times
 * across ~14k chars of tool result. The marker is written before secret projection, so it keeps
 * nothing of the raw input: a kept prefix could cut through a secret and leave a fragment no
 * whole-literal redaction matches, and a length would disclose the length of any secret in it.
 */
function compactBlockLogInputs(logs: unknown, executionId: string | undefined): unknown {
  if (!Array.isArray(logs)) return logs
  const reference = executionId ?? '<executionId>'
  return logs.map((entry) => {
    if (!isPlainRecord(entry) || !isPlainRecord(entry.input)) return entry
    const input: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(entry.input)) {
      const limit = key === 'code' ? LOG_CODE_INPUT_MAX_CHARS : LOG_INPUT_STRING_MAX_CHARS
      input[key] =
        typeof value === 'string' && value.length > limit
          ? `…[input omitted; inspect with logs get ${reference} --trace]`
          : value
    }
    return { ...entry, input }
  })
}

/**
 * Budgets for block outputs echoed to the model, a quarter of each cap the model-facing projection
 * enforces on the whole result. Reaching either cap withholds everything, including the final
 * output and error the run was for, so those keep the rest (see {@link boundRunResultForModel}). The value budget
 * usually binds first: row-shaped outputs reach the projection's traversal cap long before its
 * byte cap.
 */
const BLOCK_OUTPUT_VALUE_BUDGET = Math.floor(MAX_CONTENT_NODES / 4)
const BLOCK_OUTPUT_BYTE_BUDGET = Math.floor(MAX_MODEL_CONTENT_BYTES / 4)

interface BlockOutputSize {
  values: number
  bytes: number
  /** What the pointer reports. Never a byte count: bytes are measured before secret projection. */
  label: string
}

/**
 * Sizes one block output for the budgets. An output past a projection limit (values, bytes, or
 * depth) or one JSON cannot encode would be refused whatever else the result holds, so it is
 * sized past every budget and is always the first to be replaced.
 */
function sizeBlockOutput(output: unknown): BlockOutputSize {
  const measure = measureModelContent(output)
  if (!measure || measure.exceeded) {
    return {
      values: MAX_CONTENT_NODES + 1,
      bytes: MAX_MODEL_CONTENT_BYTES + 1,
      label: 'output omitted: too large to return',
    }
  }
  return {
    values: measure.values,
    bytes: measure.bytes,
    label: `output omitted: ${measure.values} values`,
  }
}

function blockOutputPointer(label: string, executionId: string | undefined): string {
  return `…[${label}; inspect with logs get ${executionId ?? '<executionId>'} --trace]`
}

/**
 * Replaces the bulkiest block outputs in `logs` with a pointer once they exceed the budgets
 * above, largest first, so the rest of the run still reaches the model. The pointer says
 * "inspect" rather than promising the full value, since the stored trace can itself be summarized.
 */
function compactBlockLogOutputs(logs: unknown, executionId: string | undefined): unknown {
  if (!Array.isArray(logs)) return logs
  const measured: Array<BlockOutputSize & { index: number; entry: Record<string, unknown> }> = []
  let values = 0
  let bytes = 0
  for (const [index, entry] of logs.entries()) {
    if (!isPlainRecord(entry) || entry.output === undefined) continue
    const size = sizeBlockOutput(entry.output)
    measured.push({ index, entry, ...size })
    values += size.values
    bytes += size.bytes
  }
  if (values <= BLOCK_OUTPUT_VALUE_BUDGET && bytes <= BLOCK_OUTPUT_BYTE_BUDGET) return logs

  measured.sort((left, right) => right.values - left.values || right.bytes - left.bytes)
  const compacted = [...logs]
  for (const item of measured) {
    if (values <= BLOCK_OUTPUT_VALUE_BUDGET && bytes <= BLOCK_OUTPUT_BYTE_BUDGET) break
    compacted[item.index] = { ...item.entry, output: blockOutputPointer(item.label, executionId) }
    values -= item.values
    bytes -= item.bytes
  }
  return compacted
}

/**
 * Bounds a run's whole model-facing result before secret projection. When `registry` makes the
 * projection walk the result, one past any of its caps is withheld entirely, so the final output
 * (the only part not already bounded) is replaced with a pointer instead. The result is measured
 * whole, envelope and error included, so the final output gets exactly the room the bounded logs
 * leave. A block output that run_block or run_workflow_until_block lifted into `output` is the
 * run's final output here too.
 */
export function boundRunResultForModel(
  data: Record<string, unknown>,
  error: string | undefined,
  executionId: string | undefined,
  registry: ResolvedSecretTraceRegistry | undefined
): Record<string, unknown> {
  if (!Object.hasOwn(data, 'output') || !copilotProjectionWalksContent(registry)) return data
  const whole = measureModelContent(
    error === undefined ? { output: data } : { output: data, error }
  )
  // A result JSON cannot encode is refused whatever its size, so only one past a cap is bounded.
  if (!whole?.exceeded) return data
  return { ...data, output: blockOutputPointer(sizeBlockOutput(data.output).label, executionId) }
}
