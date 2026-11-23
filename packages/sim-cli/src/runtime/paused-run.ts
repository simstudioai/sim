import { isRecordLike, toRecordOrNull } from '@sim/utils/object'
import type { V2OperationName } from '../generated/v2-api'

/** Operations whose payload is a run record that may be paused. */
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

/** The command that resumes one pause of a paused run. */
function resumeCommand(runId: string, workflowId: string, contextId: string): string {
  return `sim workflows runs resume ${shellArgument(runId)} --workflow ${shellArgument(workflowId)} --context ${shellArgument(contextId)}`
}

/**
 * The exact `runs resume` command for a paused run record, one line per point still waiting. The
 * server names the run to resume in `paused.runId` (for a resumed run that paused again, the run
 * it resumed, not the record's own `runId`) and each point's `contextId`. Null when nothing waits
 * or an id is not in the format the server issues, so no untrusted text reaches a printed
 * command.
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
    if (!isRecordLike(point) || point.status !== 'paused') continue
    if (!issuedId(point.contextId)) return null
    commands.push(resumeCommand(runId, workflowId, point.contextId))
  }
  return commands.length > 0 ? commands.join('\n') : null
}

/**
 * A run record with `next` added when it is paused for input. Any other payload comes back as it
 * was, and so does one that already has a `next`.
 */
export function withResumeNext(operation: V2OperationName, payload: unknown): unknown {
  if (!RUN_OPERATIONS.has(operation) || !isRecordLike(payload)) return payload
  if (payload.status !== 'paused' || 'next' in payload) return payload
  if (typeof payload.workflowId !== 'string') return payload
  const next = resumeCommandFor(payload, payload.workflowId)
  return next ? { ...payload, next } : payload
}
