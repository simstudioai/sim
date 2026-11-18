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
 * The model-facing log fields for one run, built from raw logs before secret projection. A `select`
 * resolves against the full logs and replaces them. Otherwise, when `registry` makes the projection
 * walk the result, long echoed inputs get a marker that keeps nothing of the raw input. Without an
 * active secret the logs cross as they always have: the server handler previews long inputs
 * (`previewLongInputs`) and the browser-run path leaves them untouched. Outputs, and any input
 * still too long for the agent's window, are bounded by {@link boundRunResultForModel}.
 */
export function presentWorkflowLogsForModel(
  logs: unknown,
  executionId: string | undefined,
  registry: ResolvedSecretTraceRegistry | undefined,
  select?: string[],
  { previewLongInputs = false }: { previewLongInputs?: boolean } = {}
): Record<string, unknown> {
  if (select?.length) return presentWorkflowLogs(logs, select)
  if (copilotProjectionWalksContent(registry)) {
    return presentWorkflowLogs(compactBlockLogInputs(logs, executionId, omittedInputMarker))
  }
  return presentWorkflowLogs(
    previewLongInputs ? compactBlockLogInputs(logs, executionId, previewedInputMarker) : logs
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

type InputMarker = (value: string, reference: string) => string

/**
 * The marker for a call walked against active secrets. It is written before secret projection, so
 * it keeps nothing of the raw input: a kept prefix could cut through a secret and leave a fragment
 * no whole-literal redaction matches, and a length would disclose the length of any secret in it.
 */
const omittedInputMarker: InputMarker = (_value, reference) =>
  `…[input omitted; inspect with logs get ${reference} --trace]`

/** The server handler's marker when no secret is active: a short preview and the full length. */
const previewedInputMarker: InputMarker = (value, reference) =>
  `${value.slice(0, LOG_INPUT_KEEP_CHARS)} …[${value.length} chars, see logs get ${reference} --trace]`

/**
 * Compacts the block inputs echoed back in `logs`. A Function block's `input.code` embeds the
 * fully serialized upstream rows, so a seven-block run repeated the same rows several times
 * across ~14k chars of tool result. The full input stays one `logs get <executionId> --trace` away.
 */
function compactBlockLogInputs(
  logs: unknown,
  executionId: string | undefined,
  marker: InputMarker
): unknown {
  if (!Array.isArray(logs)) return logs
  const reference = executionId ?? '<executionId>'
  return logs.map((entry) => {
    if (!isPlainRecord(entry) || !isPlainRecord(entry.input)) return entry
    const input: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(entry.input)) {
      const limit = key === 'code' ? LOG_CODE_INPUT_MAX_CHARS : LOG_INPUT_STRING_MAX_CHARS
      input[key] =
        typeof value === 'string' && value.length > limit ? marker(value, reference) : value
    }
    return { ...entry, input }
  })
}

/**
 * Budgets for block outputs echoed to the model once a whole result would pass a projection cap:
 * a quarter of each cap, so the final output and error the run was for keep the rest. The value
 * budget usually binds first: row-shaped outputs reach the projection's traversal cap long before
 * its byte cap.
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
 * depth) would be refused whatever else the result holds, so it is sized past every budget and is
 * always the first to be replaced. One JSON cannot encode is not a size problem: it returns
 * undefined and is left for the projection to refuse, as it always has been.
 */
function sizeBlockOutput(output: unknown): BlockOutputSize | undefined {
  const measure = measureModelContent(output)
  if (!measure) return undefined
  if (measure.exceeded) {
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
    if (!size) continue
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
 * The most serialized characters a run result carries to the agent. The agent holds a workflow
 * tool result inline up to twice its 12K-character output window and stores a larger one behind a
 * paged read, which costs the agent a round to learn whether the run passed. This leaves room for
 * the envelope and the secret projection's placeholders.
 */
const MODEL_RUN_RESULT_MAX_CHARS = 16_000
/** How much of an oversized final output stays inline, as serialized JSON, when no secret is active. */
const FINAL_OUTPUT_PREVIEW_CHARS = 4_000

/** `value` serialized the way the agent receives it; undefined for a value JSON cannot encode. */
function serialize(value: unknown): string | undefined {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return undefined
  }
}

/**
 * The head of an oversized final output and where the rest is. Only used when no secret is
 * active: a kept prefix could otherwise cut through a secret and leave a fragment no whole-literal
 * redaction matches.
 */
function finalOutputPreview(serialized: string, executionId: string | undefined): string {
  let end = FINAL_OUTPUT_PREVIEW_CHARS
  const last = serialized.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end -= 1
  return `${serialized.slice(0, end)} …[final output cut at ${end} of ${serialized.length} chars; inspect with logs get ${executionId ?? '<executionId>'} --trace]`
}

/**
 * Holds a run result to {@link MODEL_RUN_RESULT_MAX_CHARS} so the agent reads pass/fail, the
 * failing block's error, and each block's status inline. Echoed block inputs and outputs are
 * replaced with pointers, largest first, until the result fits; the per-block entries keep their
 * name, id, status, and error. If that is not enough, the final output is cut to a preview, or to a
 * pointer when `walksContent` (a secret is active). Values a caller named with `select` are kept.
 */
function fitRunResultToWindow(
  data: Record<string, unknown>,
  error: string | undefined,
  executionId: string | undefined,
  walksContent: boolean
): Record<string, unknown> {
  let total = serialize(error === undefined ? { output: data } : { output: data, error })?.length
  if (total === undefined || total <= MODEL_RUN_RESULT_MAX_CHARS) return data

  let fitted = data
  if (Array.isArray(data.logs)) {
    const parts: Array<{ index: number; field: 'input' | 'output'; size: number }> = []
    for (const [index, entry] of data.logs.entries()) {
      if (!isPlainRecord(entry)) continue
      for (const field of ['input', 'output'] as const) {
        if (entry[field] === undefined) continue
        const size = serialize(entry[field])?.length
        if (size !== undefined) parts.push({ index, field, size })
      }
    }
    parts.sort((left, right) => right.size - left.size)
    const logs = [...data.logs]
    for (const part of parts) {
      if (total <= MODEL_RUN_RESULT_MAX_CHARS) break
      const entry = logs[part.index] as Record<string, unknown>
      const pointer =
        part.field === 'input'
          ? omittedInputMarker('', executionId ?? '<executionId>')
          : blockOutputPointer(
              sizeBlockOutput(entry.output)?.label ?? 'output omitted',
              executionId
            )
      const saved = part.size - JSON.stringify(pointer).length
      if (saved <= 0) continue
      logs[part.index] = { ...entry, [part.field]: pointer }
      total -= saved
    }
    fitted = { ...data, logs }
  }
  if (total <= MODEL_RUN_RESULT_MAX_CHARS || !Object.hasOwn(fitted, 'output')) return fitted

  const serialized = serialize(fitted.output)
  if (serialized === undefined || serialized.length <= FINAL_OUTPUT_PREVIEW_CHARS) return fitted
  const label = sizeBlockOutput(fitted.output)?.label
  if (walksContent && !label) return fitted
  return {
    ...fitted,
    output: walksContent
      ? blockOutputPointer(label ?? 'output omitted', executionId)
      : finalOutputPreview(serialized, executionId),
  }
}

/**
 * Bounds a run's whole model-facing result before secret projection, in two steps. First, when
 * `registry` makes the projection walk the result, one past any of its caps is withheld entirely.
 * So a result that would pass a cap first has its bulkiest block-log outputs replaced with
 * pointers, down to their budget, and if it still would, its final output too. The result is
 * measured whole, envelope and error included. A block output that run_block or
 * run_workflow_until_block lifted into `output` is the run's final output here too. Then every
 * result, secret or not, is held to the agent's inline window ({@link fitRunResultToWindow}). A
 * result that fits both is returned untouched.
 */
export function boundRunResultForModel(
  data: Record<string, unknown>,
  error: string | undefined,
  executionId: string | undefined,
  registry: ResolvedSecretTraceRegistry | undefined
): Record<string, unknown> {
  const walksContent = copilotProjectionWalksContent(registry)
  const capped = walksContent ? boundToProjectionCaps(data, error, executionId) : data
  return fitRunResultToWindow(capped, error, executionId, walksContent)
}

function boundToProjectionCaps(
  data: Record<string, unknown>,
  error: string | undefined,
  executionId: string | undefined
): Record<string, unknown> {
  // A result JSON cannot encode is refused whatever its size, so only one past a cap is bounded.
  const passesCap = (candidate: Record<string, unknown>): boolean =>
    measureModelContent(error === undefined ? { output: candidate } : { output: candidate, error })
      ?.exceeded === true
  if (!passesCap(data)) return data

  const logsBounded = Array.isArray(data.logs)
    ? { ...data, logs: compactBlockLogOutputs(data.logs, executionId) }
    : data
  if (!passesCap(logsBounded) || !Object.hasOwn(logsBounded, 'output')) return logsBounded
  const size = sizeBlockOutput(logsBounded.output)
  return size
    ? { ...logsBounded, output: blockOutputPointer(size.label, executionId) }
    : logsBounded
}
