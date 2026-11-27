import { isRecordLike, toArray, toRecordOrNull } from '@sim/utils/object'
import type { Command } from 'commander'
import type { V2OperationName } from '../generated/v2-api'
import type { NextStep } from '../output/next-step'

/** Operations whose payload is a run record that may be paused or failed. */
const RUN_OPERATIONS: ReadonlySet<V2OperationName> = new Set(['executeWorkflow', 'getWorkflowRun'])

/** What the server issues for an id: letters, digits and `_ . : -` plus the `₍ ₎` of a branch id. */
const ISSUED_ID = /^[\p{L}\p{N}_.:\u208D\u208E-]{1,256}$/u

function issuedId(value: unknown): value is string {
  return typeof value === 'string' && ISSUED_ID.test(value)
}

const SAFE_ARGUMENT = /^[A-Za-z0-9_.:-]+$/

/** `value` as one shell word: as it is when it needs no quoting, else single-quoted. */
export function shellArgument(value: string): string {
  return SAFE_ARGUMENT.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`
}

/**
 * The command line that reaches `command` as the caller typed it: each command name from the root
 * down with the options typed on it (the root's `--workspace` or `--endpoint` too), `operands` after
 * the leaf's name, and none of the leaf's options `omit` names by attribute (`draft`), so a
 * corrected command a refusal prints keeps everything the caller chose.
 */
export function typedCommandLine(
  command: Command,
  operands: readonly string[],
  omit: ReadonlySet<string> = new Set()
): string {
  const path: Command[] = []
  for (let current: Command | null = command; current; current = current.parent) {
    path.unshift(current)
  }
  const words: string[] = []
  for (const step of path) {
    words.push(step.name(), ...(step === command ? operands.map(shellArgument) : []))
    for (const option of step.options) {
      const key = option.attributeName()
      if (!option.long || step.getOptionValueSource(key) !== 'cli') continue
      if (step === command && omit.has(key)) continue
      const value = step.getOptionValue(key)
      for (const given of Array.isArray(value) ? value : [value]) {
        if (typeof given === 'string') words.push(option.long, shellArgument(given))
        else if (given === true || (given === false && option.negate)) words.push(option.long)
      }
    }
  }
  return words.join(' ')
}

function resumeCommand(runId: string, workflowId: string, contextId: string): string {
  return `sim workflows runs resume ${shellArgument(runId)} --workflow ${shellArgument(workflowId)} --context ${shellArgument(contextId)}`
}

/**
 * The exact `runs resume` command for a paused run record, one line per human pause still waiting
 * (a timed pause resumes on its own, and the resume route refuses it). The server names the run to
 * resume in `paused.runId` (for a resumed run that paused again, the run it resumed, not the
 * record's own `runId`) and each point's `contextId`. Null when nothing waits or an id is not in
 * the format the server issues, so no untrusted text reaches a printed command.
 */
export function resumeCommandFor(
  record: Record<string, unknown>,
  workflowId: string
): string | null {
  const paused = toRecordOrNull(record.paused)
  const runId = paused?.runId
  if (!issuedId(runId) || !issuedId(workflowId)) return null
  const commands: string[] = []
  for (const point of Array.isArray(paused?.points) ? paused.points : []) {
    if (!isRecordLike(point) || point.status !== 'paused' || point.kind !== 'human') continue
    if (!issuedId(point.contextId)) return null
    commands.push(resumeCommand(runId, workflowId, point.contextId))
  }
  return commands.length > 0 ? commands.join('\n') : null
}

/** Whether a run record is a test run: a dry run, or a workflow test's run. */
function isTestRun(record: Record<string, unknown>): boolean {
  return record.trigger === 'test' || toRecordOrNull(record.overrides) !== null
}

/**
 * The selector a rerun names a side-effect entry's block by, as the run's `overrides` do: its
 * block id for a block of `workflowId`, `<workflowId>.<blockId>` for a child's.
 */
export function selectorOf(entry: Record<string, unknown>, workflowId: unknown): string {
  return entry.workflowId === workflowId
    ? String(entry.blockId)
    : `${String(entry.workflowId)}.${String(entry.blockId)}`
}

/**
 * The passed mocks this run reached, so recorded an output for: every mock of this workflow's
 * blocks its `sideEffects.unreached` does not list (a child's block is never read from a run).
 * None when the record carries no side effects (a run read back later keeps none), so no
 * `--mock-from` names an output never recorded.
 */
function reachedMocks(record: Record<string, unknown>, passed: unknown[]): Set<unknown> {
  const sideEffects = toRecordOrNull(record.sideEffects)
  if (!sideEffects) return new Set()
  const unreached = new Set(
    toArray(sideEffects.unreached).flatMap((entry) =>
      isRecordLike(entry) && entry.kind === 'mock' ? [selectorOf(entry, record.workflowId)] : []
    )
  )
  return new Set(
    passed.filter(
      (selector) => issuedId(selector) && !selector.includes('.') && !unreached.has(selector)
    )
  )
}

/**
 * The flags that keep a rerun of a test run a test: `--dry`, with a dry run's own `--allow`
 * blocks, so following `next` never sends what the run held back. A workflow test's run has no
 * `overrides` but held its writes back all the same. A mock is recorded only by block, never its
 * output, so `next` reads it again from a run: the run it was read from (`--mock-from`), or, for
 * a mock the caller passed to this workflow's block, this run itself, which recorded the output
 * the block answered with if the run reached it ({@link reachedMocks}). Only one run can be read
 * from, so a passed mock it cannot read (a child's block, one never reached, or any beside a
 * `--mock-from`) is left out of the command and returned as `unread`, for the caller to pass
 * again. Null when an id is not in the format the server issues.
 */
function dryRerunFlags(
  record: Record<string, unknown>
): { flags: string; unread: string[] } | null {
  if (!isTestRun(record)) return { flags: '', unread: [] }
  const overrides = toRecordOrNull(record.overrides)
  const flags = [' --dry']
  for (const selector of toArray(overrides?.allow)) {
    if (!issuedSelector(selector)) return null
    flags.push(` --allow ${shellArgument(selector)}`)
  }
  const mocksFrom = toRecordOrNull(overrides?.mocksFrom)
  const passed = toArray(overrides?.mocks)
  if (!passed.every(issuedSelector)) return null
  const reached = mocksFrom ? new Set<unknown>() : reachedMocks(record, passed)
  const [readFrom, read] = mocksFrom
    ? [mocksFrom.runId, toArray(mocksFrom.blocks)]
    : [record.runId, passed.filter((selector) => reached.has(selector))]
  if (read.length > 0) {
    if (!issuedId(readFrom)) return null
    flags.push(` --mock-from ${shellArgument(readFrom)}`)
    for (const blockId of read) {
      if (!issuedId(blockId)) return null
      flags.push(` --mock ${shellArgument(blockId)}`)
    }
  }
  return {
    flags: flags.join(''),
    unread: passed.filter((selector) => !reached.has(selector)).map(String),
  }
}

/** A rerun-ready selector: an issued block id, or `<workflowId>.<blockId>` of two. */
function issuedSelector(value: unknown): value is string {
  if (issuedId(value)) return true
  if (typeof value !== 'string') return false
  const dot = value.indexOf('.')
  return dot > 0 && issuedId(value.slice(0, dot)) && issuedId(value.slice(dot + 1))
}

/**
 * The command that reruns a failed run from where the server says a rerun of its failure starts
 * (`error.rerunFromBlockId`: the failed block, or the outermost loop or parallel holding it,
 * which a rerun cannot start inside), with the run as the source of every upstream output, so a
 * fix applied to that block's source is tested without repeating the blocks before it; a test
 * run's rerun stays one ({@link dryRerunFlags}), and `unread` names the mocks it leaves out.
 * Null when the server names no start block or an id is not in the format the server issues.
 */
function rerunFor(
  record: Record<string, unknown>,
  workflowId: string
): { next: NextStep; unread: string[] } | null {
  const startBlockId = toRecordOrNull(record.error)?.rerunFromBlockId
  const { runId } = record
  if (!issuedId(startBlockId) || !issuedId(runId) || !issuedId(workflowId)) return null
  const dry = dryRerunFlags(record)
  if (dry === null) return null
  return {
    next: {
      command: `sim workflows run ${shellArgument(workflowId)} --from-block ${shellArgument(startBlockId)} --source-run ${shellArgument(runId)}${dry.flags}`,
      reason: `reruns the saved draft from block ${startBlockId}, reusing this run's outputs before it${dry.flags ? ', as a dry run' : ''}`,
    },
    unread: dry.unread,
  }
}

/**
 * A run record with `next` (`{ command, reason }`) added: the `runs resume` command when it is
 * paused for input (never for a test run, which is never resumed), the rerun from the failed
 * block when it failed in one, with `nextNote` naming the mocks that rerun does not repeat. Any
 * other payload comes back as it was, and so does one that already has a `next`.
 */
export function withRunNext(operation: V2OperationName, payload: unknown): unknown {
  if (!RUN_OPERATIONS.has(operation) || !isRecordLike(payload)) return payload
  if ('next' in payload || typeof payload.workflowId !== 'string') return payload
  if (payload.status === 'paused') {
    const command = isTestRun(payload) ? null : resumeCommandFor(payload, payload.workflowId)
    if (!command) return payload
    return { ...payload, next: { command, reason: 'resumes the run where it waits for input' } }
  }
  if (payload.status !== 'failed') return payload
  const rerun = rerunFor(payload, payload.workflowId)
  if (!rerun) return payload
  return {
    ...payload,
    next: rerun.next,
    ...(rerun.unread.length > 0
      ? {
          nextNote: `next leaves out the mocks of ${rerun.unread.join(', ')}, whose outputs no run it can read recorded: add each again with --mock`,
        }
      : {}),
  }
}
