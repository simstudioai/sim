import { isRecordLike, toArray, toRecordOrNull } from '@sim/utils/object'
import type { V2OperationName } from '../generated/v2-api'

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
  return record.trigger === 'test' || toRecordOrNull(record.dryRun) !== null
}

/** `<workflowId>.<blockId>` for a child block a dry run recorded; null when either id is not issued. */
function childSelector(entry: unknown): string | null {
  const { workflowId, blockId } = toRecordOrNull(entry) ?? {}
  return issuedId(workflowId) && issuedId(blockId) ? `${workflowId}.${blockId}` : null
}

/**
 * The run's own mocked blocks it reached, so recorded an output for: every mocked block of this
 * workflow its `sideEffects.unused` does not list. None when the record carries no such list (a run
 * read back later, which keeps no side effects), so no `--mock-from` names an output never recorded.
 */
function reachedMocks(record: Record<string, unknown>): Set<unknown> {
  const unused = toRecordOrNull(record.sideEffects)?.unused
  if (!Array.isArray(unused)) return new Set()
  const unreached = new Set(
    unused.flatMap((entry) =>
      isRecordLike(entry) && entry.override === 'mock' && entry.workflowId === record.workflowId
        ? [entry.blockId]
        : []
    )
  )
  const mocked = toArray(toRecordOrNull(record.dryRun)?.mockedBlocks)
  return new Set(mocked.filter((blockId) => !unreached.has(blockId)))
}

/**
 * The flags that keep a rerun of a test run a test: `--dry`, with a dry run's own `--allow`
 * blocks (`dryRun.allowBlocks`, and a child's as `<workflowId>.<blockId>`), so following `next`
 * never sends what the run held back. A workflow test's run has no `dryRun` but held its writes
 * back all the same. A mock is recorded only by block, never its output, so `next` reads it again
 * from a run: the run it was read from (`--mock-from`), or, for a mock the caller passed to this
 * workflow's block, this run itself, which recorded the output the block answered with if the run
 * reached it ({@link reachedMocks}). Only one run can be read from, and a child's block never is,
 * so a passed mock left over holds a `<json>` placeholder the caller replaces with the output.
 * Null when an id is not in the format the server issues.
 */
function dryRerunFlags(record: Record<string, unknown>): string | null {
  if (!isTestRun(record)) return ''
  const dryRun = toRecordOrNull(record.dryRun)
  const flags = [' --dry']
  for (const blockId of toArray(dryRun?.allowBlocks)) {
    if (!issuedId(blockId)) return null
    flags.push(` --allow ${shellArgument(blockId)}`)
  }
  for (const entry of toArray(dryRun?.childAllowBlocks)) {
    const selector = childSelector(entry)
    if (selector === null) return null
    flags.push(` --allow ${shellArgument(selector)}`)
  }
  const mocksFrom = toRecordOrNull(dryRun?.mocksFrom)
  const passed = toArray(dryRun?.mockedBlocks)
  const reached = reachedMocks(record)
  const [readFrom, read, unread] = mocksFrom
    ? [mocksFrom.runId, toArray(mocksFrom.blockIds), passed]
    : [
        record.runId,
        passed.filter((blockId) => reached.has(blockId)),
        passed.filter((blockId) => !reached.has(blockId)),
      ]
  if (read.length > 0) {
    if (!issuedId(readFrom)) return null
    flags.push(` --mock-from ${shellArgument(readFrom)}`)
    for (const blockId of read) {
      if (!issuedId(blockId)) return null
      flags.push(` --mock ${shellArgument(blockId)}`)
    }
  }
  const placeholders = [
    ...unread.map((blockId) => (issuedId(blockId) ? blockId : null)),
    ...toArray(dryRun?.childMockedBlocks).map(childSelector),
  ]
  for (const selector of placeholders) {
    if (selector === null) return null
    flags.push(` --mock ${shellArgument(`${selector}=<json>`)}`)
  }
  return flags.join('')
}

/**
 * The exact command that reruns a failed run from where the server says a rerun of its failure
 * starts (`error.rerunFromBlockId`: the failed block, or the outermost loop or parallel holding
 * it, which a rerun cannot start inside), with the run as the source of every upstream output, so
 * a fix applied to that block's source is tested without repeating the blocks before it; a test
 * run's rerun stays one ({@link dryRerunFlags}). Null when the server names no start block or an
 * id is not in the format the server issues.
 */
function rerunCommandFor(record: Record<string, unknown>, workflowId: string): string | null {
  const startBlockId = toRecordOrNull(record.error)?.rerunFromBlockId
  const { runId } = record
  if (!issuedId(startBlockId) || !issuedId(runId) || !issuedId(workflowId)) return null
  const dry = dryRerunFlags(record)
  if (dry === null) return null
  return `sim workflows run ${shellArgument(workflowId)} --from-block ${shellArgument(startBlockId)} --source-run ${shellArgument(runId)}${dry}`
}

/**
 * A run record with `next` added: the `runs resume` command when it is paused for input (never
 * for a test run, which is never resumed), the rerun from the failed block when it failed in one.
 * Any other payload comes back as it was, and so does one that already has a `next`.
 */
export function withRunNext(operation: V2OperationName, payload: unknown): unknown {
  if (!RUN_OPERATIONS.has(operation) || !isRecordLike(payload)) return payload
  if ('next' in payload || typeof payload.workflowId !== 'string') return payload
  const next =
    payload.status === 'paused'
      ? isTestRun(payload)
        ? null
        : resumeCommandFor(payload, payload.workflowId)
      : payload.status === 'failed'
        ? rerunCommandFor(payload, payload.workflowId)
        : null
  return next ? { ...payload, next } : payload
}
