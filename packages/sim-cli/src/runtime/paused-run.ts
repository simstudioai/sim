import { isRecordLike, toRecordOrNull } from '@sim/utils/object'
import type { V2OperationName } from '../generated/v2-api'

/** Operations whose payload is a run record that may be paused. */
const RUN_OPERATIONS: ReadonlySet<V2OperationName> = new Set(['executeWorkflow', 'getWorkflowRun'])

interface ResumeLinks {
  contextId: string
  executionId: string
}

/** What the server issues for an id: letters, digits and `_ . : -` plus the `₍ ₎` of a branch id. */
const ISSUED_ID = /^[\p{L}\p{N}_.:\u208D\u208E-]{1,256}$/u

function issuedId(value: unknown): value is string {
  return typeof value === 'string' && ISSUED_ID.test(value)
}

function readLinks(value: unknown): ResumeLinks | null {
  if (!isRecordLike(value)) return null
  const { contextId, executionId } = value
  return issuedId(contextId) && issuedId(executionId) ? { contextId, executionId } : null
}

/**
 * The resume links of every pause in a run's output: `resume` beside a pause response, or
 * `_resume` inside its `data`; the response is the output itself (or its `response`) for one
 * pause, and each entry of `pausedBlocks` when several blocks pause together. Only those fixed
 * places are read, never data a block or an API response carries, and a link whose ids are not
 * in the format the server issues is skipped.
 */
function findResumeLinks(output: unknown): ResumeLinks[] {
  if (!isRecordLike(output)) return []
  const found = new Map<string, ResumeLinks>()
  for (const root of [output, output.response]) {
    if (!isRecordLike(root)) continue
    const responses = Array.isArray(root.pausedBlocks) ? root.pausedBlocks : [root]
    for (const response of responses) {
      if (!isRecordLike(response)) continue
      const links = readLinks(response.resume) ?? readLinks(toRecordOrNull(response.data)?._resume)
      if (links) found.set(`${links.executionId}\n${links.contextId}`, links)
    }
  }
  return [...found.values()]
}

const SAFE_ARGUMENT = /^[A-Za-z0-9_.:-]+$/

function shellArgument(value: string): string {
  return SAFE_ARGUMENT.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`
}

/** The command that resumes a paused run, with the pause's context when it is known. */
function resumeCommand(runId: string, workflowId: string, contextId: string | null): string {
  const context = contextId ? ` --context ${shellArgument(contextId)}` : ''
  return `sim workflows runs resume ${shellArgument(runId)} --workflow ${shellArgument(workflowId)}${context}`
}

/**
 * The exact `runs resume` command for a paused run record, one line per waiting pause, since the
 * record carries two ids (`runId` and the output's `_resume.executionId`) and a context a reader
 * would otherwise have to pair up. `runs resume` takes the run the pause belongs to, which is the
 * links' `executionId`. A record whose output names no links falls back to its own ids and the
 * `paused.contextId`; null when an id is not in the format the server issues, so no untrusted
 * text reaches a printed command. `fallback` supplies the ids a record omits.
 */
export function resumeCommandFor(
  record: Record<string, unknown>,
  fallback: { runId: string; workflowId: string }
): string | null {
  const runId = typeof record.runId === 'string' ? record.runId : fallback.runId
  const workflowId = typeof record.workflowId === 'string' ? record.workflowId : fallback.workflowId
  if (!issuedId(runId) || !issuedId(workflowId)) return null
  const links = findResumeLinks(record.output)
  if (links.length > 0) {
    return links
      .map((link) => resumeCommand(link.executionId, workflowId, link.contextId))
      .join('\n')
  }
  const contextId = toRecordOrNull(record.paused)?.contextId
  return resumeCommand(runId, workflowId, issuedId(contextId) ? contextId : null)
}

/**
 * A run record with `next` added when it is paused for input. Any other payload comes back as it
 * was, and so does one that already has a `next`.
 */
export function withResumeNext(operation: V2OperationName, payload: unknown): unknown {
  if (!RUN_OPERATIONS.has(operation) || !isRecordLike(payload)) return payload
  if (payload.status !== 'paused' || 'next' in payload) return payload
  if (typeof payload.runId !== 'string' || typeof payload.workflowId !== 'string') return payload
  const next = resumeCommandFor(payload, { runId: payload.runId, workflowId: payload.workflowId })
  return next ? { ...payload, next } : payload
}
