import { boundAnswerFindings } from '@sim/workflow-code/diagnostics'
import type { ContractJsonResponse } from '@/lib/api/contracts/types'
import type { v2ApplyWorkflowSourceContract } from '@/lib/api/contracts/v2/workflow-source'
import type { SourceOutcome } from '@/lib/workflows/application/source-pipeline'

/** The v2 wire shape of a source apply, plan or create outcome: the same for all three routes. */
type SourceOutcomeData = ContractJsonResponse<typeof v2ApplyWorkflowSourceContract>['data']

/**
 * The v2 wire shape of a source write's outcome: exactly the fields the source routes' response
 * schema exposes, so in-process fields (the workflow name, references, source meta flags) never
 * reach the wire. Its findings are bounded here, once (`boundAnswerFindings`).
 */
export function presentSourceOutcome(outcome: SourceOutcome): SourceOutcomeData {
  return {
    workflowId: outcome.workflowId,
    workspaceId: outcome.workspaceId,
    dryRun: outcome.dryRun,
    applied: outcome.applied,
    diff: outcome.diff,
    diagnostics: boundAnswerFindings(outcome.diagnostics),
    files: outcome.files,
    lock: outcome.lock,
    base: outcome.base,
    mintedIds: outcome.mintedIds,
    notes: outcome.notes,
    needsRedeployment: outcome.needsRedeployment,
  }
}
