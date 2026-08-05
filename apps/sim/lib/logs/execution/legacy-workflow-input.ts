import { isRecordLike, omit } from '@sim/utils/object'

/**
 * The shape the executor records for a trigger block: never executed, zero
 * duration, populated output (`executor.ts` `setBlockState` after
 * `buildStartBlockOutput`).
 *
 * The shape is not unique to the trigger. A human-in-the-loop pause writes a
 * placeholder block state with the same three properties (`block-executor.ts`,
 * `{ url, resumeEndpoint }` output), so a run that paused has more than one
 * match. Callers that cannot tolerate the wrong block must disambiguate - see
 * {@link recoverLegacyWorkflowInputForDisplay}.
 */
function isLegacyTriggerBlockState(state: unknown): state is { output: unknown } {
  return (
    isRecordLike(state) &&
    state.executed === false &&
    state.executionTime === 0 &&
    state.output != null
  )
}

function collectLegacyTriggerOutputs(executionData: Record<string, unknown>): unknown[] {
  if (!isRecordLike(executionData.executionState)) return []
  const { blockStates } = executionData.executionState
  if (!isRecordLike(blockStates)) return []

  const outputs: unknown[] = []
  for (const state of Object.values(blockStates)) {
    if (isLegacyTriggerBlockState(state)) outputs.push(state.output)
  }
  return outputs
}

/**
 * Recovers the inbound trigger payload from execution data written before
 * `workflowInput` was persisted as a top-level field.
 *
 * Returns the first matching block state, preserving the long-standing
 * behavior of the functional re-run reader. Display callers must use
 * {@link recoverLegacyWorkflowInputForDisplay}, which refuses to guess.
 */
export function extractLegacyWorkflowInput(
  executionData: Record<string, unknown>
): unknown | undefined {
  return collectLegacyTriggerOutputs(executionData)[0]
}

/**
 * Whether the persisted state carries block states at all.
 *
 * Callers pair this with an absent provenance key. The trace registry is
 * attached before the executor runs (`execution-core.ts` installs it ahead of
 * `safeStart`), so any execution that produced block states also stamped
 * provenance. An absent key together with populated block states therefore
 * identifies pre-stamping data, and never a post-stamping run that failed
 * early enough to miss the stamp - those carry no block states to recover from.
 */
export function hasPersistedBlockStates(executionData: Record<string, unknown>): boolean {
  if (!isRecordLike(executionData.executionState)) return false
  const { blockStates } = executionData.executionState
  return isRecordLike(blockStates) && Object.keys(blockStates).length > 0
}

/**
 * Keys that the trigger block hoists next to a nested `input` payload. Blob
 * forensics on pre-persistence executions show the block output is a strict
 * superset of the original `workflowInput` in this shape, so the recovered
 * value is projected back down to `{ input }`.
 */
const NESTED_INPUT_KEY = 'input'

/**
 * Whether the nested `input` is merely a clone of its sibling keys.
 *
 * `buildApiOrInputOutput` records an object input as
 * `{ ...finalInput, input: { ...finalInput } }`, so the original
 * `workflowInput` was the FLAT object and the nested copy is redundant.
 * Narrowing that shape to `{ input }` would display something the run never
 * received. The superset shape the narrowing targets is distinguishable: its
 * nested `input` carries keys the siblings do not.
 */
function isNestedInputSiblingClone(recovered: Record<string, unknown>): boolean {
  const nested = recovered[NESTED_INPUT_KEY]
  if (!isRecordLike(nested)) return false

  const siblings = omit(recovered, [NESTED_INPUT_KEY])
  const siblingKeys = Object.keys(siblings)
  if (siblingKeys.length === 0 || siblingKeys.length !== Object.keys(nested).length) return false

  return siblingKeys.every(
    (key) =>
      Object.hasOwn(nested, key) && JSON.stringify(siblings[key]) === JSON.stringify(nested[key])
  )
}

/**
 * A Slack verification token echoed into the trigger block output. It is the
 * only key that diverges from the original `workflowInput` in the Slack
 * envelope shape, and it is secret-shaped, so it is dropped rather than
 * displayed with a value that is both wrong and sensitive.
 */
const DROPPED_RECOVERED_KEYS = ['token'] as const

/**
 * Recovers `workflowInput` for the log display projection, narrowing the raw
 * trigger block output to the shape the field originally held. Functional
 * readers must keep using {@link extractLegacyWorkflowInput} directly - this
 * narrowing is display-only and intentionally lossy.
 *
 * Callers must restrict this to executions written before resolved-secret
 * provenance was stamped. Block state is gated content, and this routes it to
 * the ungated workflow-boundary envelope; that is only sound while the matched
 * block is the trigger, which holds the payload captured before any secret was
 * resolved.
 *
 * Recovery is therefore refused when more than one block state matches the
 * trigger shape - a paused run also carries a resume placeholder with the same
 * shape, and showing its `{ url, resumeEndpoint }` output labelled as the
 * workflow input would be both wrong and a capability-URL disclosure. An empty
 * panel beats confidently wrong content.
 */
export function recoverLegacyWorkflowInputForDisplay(
  executionData: Record<string, unknown>
): unknown | undefined {
  const candidates = collectLegacyTriggerOutputs(executionData)
  if (candidates.length !== 1) return undefined

  const recovered = candidates[0]
  if (!isRecordLike(recovered)) return recovered

  const narrowed: Record<string, unknown> =
    isRecordLike(recovered[NESTED_INPUT_KEY]) && !isNestedInputSiblingClone(recovered)
      ? { [NESTED_INPUT_KEY]: recovered[NESTED_INPUT_KEY] }
      : recovered

  return omit(narrowed, [...DROPPED_RECOVERED_KEYS])
}
