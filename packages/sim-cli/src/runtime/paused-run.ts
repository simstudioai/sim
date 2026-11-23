import { isRecordLike, toRecordOrNull } from '@sim/utils/object'
import type { V2OperationName } from '../generated/v2-api'

/** Operations whose payload is a run record that may be paused. */
const RUN_OPERATIONS: ReadonlySet<V2OperationName> = new Set(['executeWorkflow', 'getWorkflowRun'])

/** Records visited in a paused run's output while looking for its resume links. */
const SEARCH_BUDGET = 500
const SEARCH_DEPTH = 6

interface ResumeLinks {
  contextId: string
  executionId: string
}

/**
 * The resume links a human-in-the-loop pause leaves in a run's output (`_resume`, or `resume`
 * beside the response): the record holding both the pause's `contextId` and the `executionId`
 * `runs resume` takes as its run.
 */
function findResumeLinks(output: unknown): ResumeLinks | null {
  let visited = 0
  const search = (value: unknown, depth: number): ResumeLinks | null => {
    if (!isRecordLike(value) || depth > SEARCH_DEPTH || visited++ >= SEARCH_BUDGET) return null
    if (typeof value.contextId === 'string' && typeof value.executionId === 'string') {
      return { contextId: value.contextId, executionId: value.executionId }
    }
    for (const child of Object.values(value)) {
      const found = search(child, depth + 1)
      if (found) return found
    }
    return null
  }
  return search(output, 0)
}

/** The command that resumes a paused run, with the pause's context when it is known. */
export function resumeCommand(runId: string, workflowId: string, contextId: string | null): string {
  const context = contextId ? ` --context ${contextId}` : ''
  return `sim workflows runs resume ${runId} --workflow ${workflowId}${context}`
}

/**
 * A run record with `next` added when it is paused for input: the exact `runs resume` command,
 * since the record carries two ids (`runId` and the output's `_resume.executionId`) and a context
 * a reader would otherwise have to pair up. `runs resume` takes the run the pause belongs to,
 * which is `_resume.executionId` when the output names one. Any other payload comes back as it
 * was, and so does one that already has a `next`.
 */
export function withResumeNext(operation: V2OperationName, payload: unknown): unknown {
  if (!RUN_OPERATIONS.has(operation) || !isRecordLike(payload)) return payload
  if (payload.status !== 'paused' || 'next' in payload) return payload
  if (typeof payload.runId !== 'string' || typeof payload.workflowId !== 'string') return payload
  const links = findResumeLinks(payload.output)
  const paused = toRecordOrNull(payload.paused)
  const contextId =
    links?.contextId ?? (typeof paused?.contextId === 'string' ? paused.contextId : null)
  return {
    ...payload,
    next: resumeCommand(links?.executionId ?? payload.runId, payload.workflowId, contextId),
  }
}
