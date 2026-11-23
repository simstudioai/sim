import { isPlainRecord, isRecordLike } from '@sim/utils/object'
import { copilotProjectionWalksContent } from '@/lib/mothership/request/tools/resolved-secret-result'
import {
  MAX_CONTENT_NODES,
  MAX_MODEL_CONTENT_BYTES,
  measureModelContent,
  projectResolvedSecretModelContent,
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
 * The most serialized characters a run result carries to the agent, measured after secret
 * projection. The agent holds a workflow tool result inline up to twice its 12K-character output
 * window and stores a larger one behind a paged read, which costs the agent a round to learn
 * whether the run passed. This leaves room for the envelope.
 */
const MODEL_RUN_RESULT_MAX_CHARS = 16_000
/** The most of an oversized final output that stays inline, as serialized JSON, when no secret is active. */
const FINAL_OUTPUT_PREVIEW_CHARS = 4_000
/** A preview shorter than this says too little to be worth more than a pointer. */
const FINAL_OUTPUT_PREVIEW_MIN_CHARS = 200
/** The head of an oversized error that stays inline; an HTTP failure can carry a whole HTML page. */
const ERROR_KEEP_CHARS = 1_500
/** Block entries kept at each end of a long run (loop iterations) beside every failed one. */
const KEPT_EDGE_LOG_ENTRIES = 5
/** Stands in for a failed block's error that repeats the run error word for word. */
const SAME_AS_RUN_ERROR = '…[same as the run error]'

/** A run result as the agent reads it: the tool's data and its separate error. */
interface ModelRunResult {
  data: Record<string, unknown>
  error: string | undefined
}

/** `value` serialized the way the agent receives it; undefined for a value JSON cannot encode. */
function serialize(value: unknown): string | undefined {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return undefined
  }
}

/** `chars`, stepped back off a high surrogate so a cut never splits a pair. */
function cutPoint(text: string, chars: number): number {
  const last = text.charCodeAt(chars - 1)
  return last >= 0xd800 && last <= 0xdbff ? chars - 1 : chars
}

/**
 * The head of an oversized final output and where the rest is. Only used when no secret is
 * active: a kept prefix could otherwise cut through a secret and leave a fragment no whole-literal
 * redaction matches.
 */
function finalOutputPreview(
  serialized: string,
  chars: number,
  executionId: string | undefined
): string {
  const end = cutPoint(serialized, chars)
  return `${serialized.slice(0, end)} …[final output cut at ${end} of ${serialized.length} chars; inspect with logs get ${executionId ?? '<executionId>'} --trace]`
}

/** Whether a failed block's error only repeats the run error (`failedBlockError` prefixes the name). */
function repeatsRunError(entry: Record<string, unknown>, runError: string | undefined): boolean {
  if (runError === undefined || typeof entry.error !== 'string' || entry.error === '') return false
  return (
    entry.error === runError ||
    (typeof entry.blockName === 'string' && `${entry.blockName}: ${entry.error}` === runError) ||
    (typeof entry.blockId === 'string' && `${entry.blockId}: ${entry.error}` === runError)
  )
}

/**
 * Holds a run result to {@link MODEL_RUN_RESULT_MAX_CHARS} so the agent reads pass/fail, the
 * failing block, its error, and each block's status inline. Each step runs only while the result is
 * still over, cheapest loss first:
 * 1. A failed block's error that repeats the run error is replaced with a marker.
 * 2. Echoed block inputs and outputs become pointers, largest first.
 * 3. Errors past {@link ERROR_KEEP_CHARS} keep their head and a pointer. The text is cut after
 *    secret projection, so no cut can strand part of a secret.
 * 4. A long run of block entries keeps every failed one and those at each end.
 * 5. The final output is cut to a preview that fits what is left, or to a pointer while a secret
 *    is active.
 * Values a caller named with `select` are kept. A result that still does not fit is returned as
 * far as it was reduced.
 *
 * While `registry` makes the projection walk the result, its size is measured as projected:
 * replacing many short secrets with their longer names can grow it. Raw sizes rank the parts and
 * skip the projection while the raw result is plainly over.
 */
function fitRunResultToWindow(
  data: Record<string, unknown>,
  error: string | undefined,
  executionId: string | undefined,
  registry: ResolvedSecretTraceRegistry | undefined,
  walksContent: boolean
): ModelRunResult {
  const reference = executionId ?? '<executionId>'
  const envelope = (candidate: ModelRunResult) =>
    candidate.error === undefined
      ? { output: candidate.data }
      : { output: candidate.data, error: candidate.error }
  const rawChars = (candidate: ModelRunResult) =>
    serialize(envelope(candidate))?.length ?? Number.POSITIVE_INFINITY
  const fits = (candidate: ModelRunResult, raw = rawChars(candidate)): boolean => {
    if (raw > MODEL_RUN_RESULT_MAX_CHARS) return false
    if (!walksContent) return true
    const projection = projectResolvedSecretModelContent(envelope(candidate), registry)
    const projected = projection.safe ? serialize(projection.value)?.length : undefined
    return (projected ?? raw) <= MODEL_RUN_RESULT_MAX_CHARS
  }
  const withLogs = (candidate: ModelRunResult, logs: unknown[]): ModelRunResult => ({
    ...candidate,
    data: { ...candidate.data, logs },
  })

  let fitted: ModelRunResult = { data, error }
  const initialRaw = serialize(envelope(fitted))?.length
  if (initialRaw === undefined || fits(fitted, initialRaw)) return fitted

  if (Array.isArray(data.logs)) {
    const runError = error ?? (typeof data.error === 'string' ? data.error : undefined)
    const deduplicated = data.logs.map((entry) =>
      isPlainRecord(entry) && repeatsRunError(entry, runError)
        ? { ...entry, error: SAME_AS_RUN_ERROR }
        : entry
    )
    fitted = withLogs(fitted, deduplicated)
    if (fits(fitted)) return fitted

    const parts: Array<{ index: number; field: 'input' | 'output'; size: number }> = []
    for (const [index, entry] of deduplicated.entries()) {
      if (!isPlainRecord(entry)) continue
      for (const field of ['input', 'output'] as const) {
        if (entry[field] === undefined) continue
        const size = serialize(entry[field])?.length
        if (size !== undefined) parts.push({ index, field, size })
      }
    }
    parts.sort((left, right) => right.size - left.size)
    const logs = [...deduplicated]
    let raw = rawChars(fitted)
    for (const part of parts) {
      const entry = logs[part.index] as Record<string, unknown>
      const pointer =
        part.field === 'input'
          ? omittedInputMarker('', reference)
          : blockOutputPointer(
              sizeBlockOutput(entry.output)?.label ?? 'output omitted',
              executionId
            )
      const saved = part.size - JSON.stringify(pointer).length
      if (saved <= 0) continue
      logs[part.index] = { ...entry, [part.field]: pointer }
      raw -= saved
      fitted = withLogs(fitted, logs)
      if (fits(fitted, raw)) return fitted
    }
  }

  fitted = capErrors(fitted, reference, registry, walksContent)
  if (fits(fitted)) return fitted

  if (Array.isArray(fitted.data.logs)) {
    fitted = withLogs(fitted, keepFailedAndEdgeEntries(fitted.data.logs, reference))
    if (fits(fitted)) return fitted
  }

  if (!Object.hasOwn(fitted.data, 'output')) return fitted
  // A final output no longer than a preview is what the run was for; it stays whole.
  const serialized = serialize(fitted.data.output)
  if (serialized === undefined || serialized.length <= FINAL_OUTPUT_PREVIEW_CHARS) return fitted
  const label = sizeBlockOutput(fitted.data.output)?.label
  if (!label) return fitted
  const withOutput = (output: unknown): ModelRunResult => ({
    ...fitted,
    data: { ...fitted.data, output },
  })
  const pointed = withOutput(blockOutputPointer(label, executionId))
  if (walksContent) return pointed

  let chars = Math.min(FINAL_OUTPUT_PREVIEW_CHARS, MODEL_RUN_RESULT_MAX_CHARS - rawChars(pointed))
  while (chars >= FINAL_OUTPUT_PREVIEW_MIN_CHARS && chars < serialized.length) {
    const previewed = withOutput(finalOutputPreview(serialized, chars, executionId))
    const previewedChars = rawChars(previewed)
    if (previewedChars <= MODEL_RUN_RESULT_MAX_CHARS) return previewed
    // JSON escapes inside the preview grow it once it is embedded as a string.
    chars -= previewedChars - MODEL_RUN_RESULT_MAX_CHARS
  }
  return pointed
}

/**
 * `text` as the agent will read it, cut to {@link ERROR_KEEP_CHARS} with a pointer to the rest.
 * While a secret is active the text is projected first and the projection is what gets cut, so a
 * cut can only fall inside a secret's name, never the secret. Text the projection cannot vouch for
 * is left whole for the result's own projection to decide.
 */
function capErrorText(
  text: string,
  reference: string,
  registry: ResolvedSecretTraceRegistry | undefined,
  walksContent: boolean
): string {
  if (text.length <= ERROR_KEEP_CHARS) return text
  let visible = text
  if (walksContent) {
    const projection = projectResolvedSecretModelContent(text, registry)
    if (!projection.safe || typeof projection.value !== 'string') return text
    visible = projection.value
    if (visible.length <= ERROR_KEEP_CHARS) return visible
  }
  const end = cutPoint(visible, ERROR_KEEP_CHARS)
  return `${visible.slice(0, end)} …[error cut at ${end} of ${visible.length} chars; inspect with logs get ${reference} --trace]`
}

function capErrors(
  result: ModelRunResult,
  reference: string,
  registry: ResolvedSecretTraceRegistry | undefined,
  walksContent: boolean
): ModelRunResult {
  const cap = (text: string) => capErrorText(text, reference, registry, walksContent)
  const data: Record<string, unknown> = { ...result.data }
  if (typeof data.error === 'string') data.error = cap(data.error)
  if (Array.isArray(data.logs)) {
    data.logs = data.logs.map((entry) =>
      isPlainRecord(entry) && typeof entry.error === 'string'
        ? { ...entry, error: cap(entry.error) }
        : entry
    )
  }
  return { data, error: result.error === undefined ? undefined : cap(result.error) }
}

/**
 * The block entries of a long run (a loop's iterations) cut to every failed one plus
 * {@link KEPT_EDGE_LOG_ENTRIES} at each end; each gap becomes one marker naming how many entries
 * it stands for.
 */
function keepFailedAndEdgeEntries(logs: unknown[], reference: string): unknown[] {
  const kept: unknown[] = []
  let omitted = 0
  const flush = () => {
    if (omitted === 0) return
    kept.push(`…[${omitted} block entries omitted; inspect with logs get ${reference} --trace]`)
    omitted = 0
  }
  for (const [index, entry] of logs.entries()) {
    const failed =
      isPlainRecord(entry) && (entry.success === false || typeof entry.error === 'string')
    const atEdge = index < KEPT_EDGE_LOG_ENTRIES || index >= logs.length - KEPT_EDGE_LOG_ENTRIES
    if (failed || atEdge) {
      flush()
      kept.push(entry)
    } else {
      omitted += 1
    }
  }
  flush()
  return kept
}

/**
 * Bounds a run's whole model-facing result, its data and its error, before the result's secret
 * projection, in two steps. First, when `registry` makes the projection walk the result, one past
 * any of its caps is withheld entirely. So a result that would pass a cap first has its bulkiest
 * block-log outputs replaced with pointers, down to their budget, and if it still would, its final
 * output too. The result is measured whole, envelope and error included. A block output that
 * run_block or run_workflow_until_block lifted into `output` is the run's final output here too.
 * Then every result, secret or not, is held to the agent's inline window
 * ({@link fitRunResultToWindow}). A result that fits both is returned untouched.
 */
export function boundRunResultForModel(
  data: Record<string, unknown>,
  error: string | undefined,
  executionId: string | undefined,
  registry: ResolvedSecretTraceRegistry | undefined
): ModelRunResult {
  const walksContent = copilotProjectionWalksContent(registry)
  const capped = walksContent ? boundToProjectionCaps(data, error, executionId) : data
  return fitRunResultToWindow(capped, error, executionId, registry, walksContent)
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
