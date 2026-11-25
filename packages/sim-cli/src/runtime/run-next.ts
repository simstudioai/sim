import { isRecordLike, toRecordOrNull } from '@sim/utils/object'
import type { V2OperationName } from '../generated/v2-api'

/** Operations whose payload is a run record that may be paused or failed. */
const RUN_OPERATIONS: ReadonlySet<V2OperationName> = new Set(['executeWorkflow', 'getWorkflowRun'])

/** What the server issues for an id: letters, digits and `_ . : -` plus the `₍ ₎` of a branch id. */
const ISSUED_ID = /^[\p{L}\p{N}_.:\u208D\u208E-]{1,256}$/u

function issuedId(value: unknown): value is string {
  return typeof value === 'string' && ISSUED_ID.test(value)
}

const SAFE_ARGUMENT = /^[A-Za-z0-9_.:-]+$/

function shellArgument(value: string): string {
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

/**
 * The exact command that reruns a failed run from where the server says a rerun of its failure
 * starts (`error.rerunFromBlockId`: the failed block, or the outermost loop or parallel holding
 * it, which a rerun cannot start inside), with the run as the source of every upstream output, so
 * a fix applied to that block's source is tested without repeating the blocks before it; a dry
 * run's rerun adds `--dry`. Null
 * when the server names no start block or an id is not in the format the server issues.
 */
function rerunCommandFor(record: Record<string, unknown>, workflowId: string): string | null {
  const startBlockId = toRecordOrNull(record.error)?.rerunFromBlockId
  const { runId } = record
  if (!issuedId(startBlockId) || !issuedId(runId) || !issuedId(workflowId)) return null
  // A dry run's rerun stays dry, so following `next` never sends what the run held back.
  const dry = isRecordLike(record.sideEffects) ? ' --dry' : ''
  return `sim workflows run ${shellArgument(workflowId)} --from-block ${shellArgument(startBlockId)} --source-run ${shellArgument(runId)}${dry}`
}

/**
 * A run record with `next` added: the `runs resume` command when it is paused for input, the
 * rerun from the failed block when it failed in one. Any other payload comes back as it was, and
 * so does one that already has a `next`.
 */
export function withRunNext(operation: V2OperationName, payload: unknown): unknown {
  if (!RUN_OPERATIONS.has(operation) || !isRecordLike(payload)) return payload
  if ('next' in payload || typeof payload.workflowId !== 'string') return payload
  const next =
    payload.status === 'paused'
      ? resumeCommandFor(payload, payload.workflowId)
      : payload.status === 'failed'
        ? rerunCommandFor(payload, payload.workflowId)
        : null
  return next ? { ...payload, next } : payload
}
