import type { V2ApplyWorkflowSourceData } from '@/lib/api/contracts/v2/workflow-source'

/** The v2 wire shape of a source apply or create, shared by both routes. */
export function presentSourceApply(result: V2ApplyWorkflowSourceData): {
  data: V2ApplyWorkflowSourceData
} {
  return {
    data: {
      workflowId: result.workflowId,
      workspaceId: result.workspaceId,
      dryRun: result.dryRun,
      applied: result.applied,
      diff: result.diff,
      diagnostics: result.diagnostics,
      files: result.files,
      lock: result.lock,
      base: result.base,
      mintedIds: result.mintedIds,
      notes: result.notes,
      needsRedeployment: result.needsRedeployment,
    },
  }
}
