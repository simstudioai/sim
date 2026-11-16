import { isUserCredentialPrincipal, type Principal } from '@sim/auth/principal'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import type { WorkflowWriteSource } from '@/lib/posthog/events'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  WorkflowSourceRejectedError,
  WorkflowSourceStaleError,
} from '@/lib/workflows/application/source-error'
import type { SourceDiffSummary } from '@/lib/workflows/application/source-locate'

type SourceOperation = 'apply' | 'create'

interface SourceSubmissionFacts {
  principal: Principal
  client: string | undefined
  operation: SourceOperation
  workspaceId: string
}

/**
 * The user a workflow-source write is attributed to in analytics, and the surface it came
 * through: a personal key or OAuth token counts as the user behind it (`cli` when the CLI
 * submitted it), a Copilot delegation as its subject user. Anything else is not attributed.
 */
function sourceWriteActor(
  principal: Principal,
  client: string | undefined
): { userId: string; source: WorkflowWriteSource } | null {
  if (isUserCredentialPrincipal(principal)) {
    return { userId: principal.userId, source: client === 'cli' ? 'cli' : 'api' }
  }
  if (principal.kind === 'delegated' && principal.serviceId === 'copilot') {
    return { userId: principal.subjectUserId, source: 'copilot' }
  }
  return null
}

function changeCount({ blocks, edges, variables }: SourceDiffSummary): number {
  return (
    blocks.added.length +
    blocks.removed.length +
    blocks.renamed.length +
    blocks.modified.length +
    edges.added +
    edges.removed +
    variables.added.length +
    variables.removed.length +
    variables.modified.length
  )
}

/**
 * A committed source write: `workflow_source_applied` with `ok: true`, and for a create also
 * `workflow_created`, so a workflow created from source counts as a creation like any other.
 */
export function recordSourceWritten(
  facts: SourceSubmissionFacts,
  written: { workflowId: string; workflowName: string; diff: SourceDiffSummary }
): void {
  const actor = sourceWriteActor(facts.principal, facts.client)
  if (!actor) return
  const groups = { workspace: facts.workspaceId }
  captureServerEvent(
    actor.userId,
    'workflow_source_applied',
    {
      workflow_id: written.workflowId,
      workspace_id: facts.workspaceId,
      source: actor.source,
      operation: facts.operation,
      ok: true,
      ops: changeCount(written.diff),
    },
    { groups }
  )
  if (facts.operation !== 'create') return
  captureServerEvent(
    actor.userId,
    'workflow_created',
    {
      workflow_id: written.workflowId,
      workspace_id: facts.workspaceId,
      name: written.workflowName,
      source: actor.source,
    },
    { groups, setOnce: { first_workflow_created_at: new Date().toISOString() } }
  )
}

/** Why a source write was refused, for `workflow_source_applied.error_kind`; null when it was not. */
function refusalKind(error: unknown): string | null {
  if (error instanceof WorkflowSourceStaleError) return 'stale'
  if (error instanceof WorkflowSourceRejectedError) return 'rejected'
  if (asOrchestrationError(error)?.code === 'locked') return 'locked'
  return null
}

/**
 * A refused source write (stale base, rejected source or locked workflow): `workflow_source_applied`
 * with `ok: false` and the refusal's `error_kind`, so retries per task are measurable. Other
 * failures (not found, forbidden, faults) are not apply outcomes and are not recorded. A refused
 * create has no workflow, so its `workflow_id` is empty.
 */
export function recordSourceRefused(
  facts: SourceSubmissionFacts & { workflowId: string },
  error: unknown
): void {
  const kind = refusalKind(error)
  if (!kind) return
  const actor = sourceWriteActor(facts.principal, facts.client)
  if (!actor) return
  captureServerEvent(
    actor.userId,
    'workflow_source_applied',
    {
      workflow_id: facts.workflowId,
      workspace_id: facts.workspaceId,
      source: actor.source,
      operation: facts.operation,
      ok: false,
      ops: 0,
      error_kind: kind,
    },
    { groups: { workspace: facts.workspaceId } }
  )
}
