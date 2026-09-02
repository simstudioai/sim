import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import type { OrchestrationErrorCode } from '@/lib/core/orchestration/types'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import {
  resolveWorkflowFolderPath,
  workflowFolderPathForId,
} from '@/lib/workflows/application/workflow-folders'
import { WorkflowImportError } from '@/lib/workflows/application/workflow-import-error'
import {
  buildWorkflowExportPayload,
  type WorkflowExportPayload,
} from '@/lib/workflows/operations/export-workflow'
import {
  type ImportedWorkflow,
  importWorkflowIntoWorkspaceTransition,
} from '@/lib/workflows/operations/import-workflow'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export interface ImportWorkflowInput {
  workspaceId: string
  folderPath?: string
  name?: string
  description?: string
  workflow: string | Record<string, unknown>
}

export interface ImportWorkflowResult {
  workflow: ImportedWorkflow
  folderPath: string
}

export interface ExportWorkflowInput {
  workflowId: string
}

export interface ExportWorkflowResult {
  payload: WorkflowExportPayload
  folderPath: string
}

function importErrorCode(status: number): OrchestrationErrorCode {
  if (status === 400) return 'validation'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 423) return 'locked'
  return 'internal'
}

export const importWorkflow = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.import,
  resolveContext: ({ input }: { input: ImportWorkflowInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  async execute({ principal, input, context }): Promise<ImportWorkflowResult> {
    const resolution = await resolveWorkflowFolderPath(context.workspaceId, input.folderPath ?? '/')

    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const result = await importWorkflowIntoWorkspaceTransition({
      workspaceId: context.workspaceId,
      folderId: resolution.folderId ?? undefined,
      name: input.name,
      description: input.description,
      workflow: input.workflow,
      userId: attribution.attributedUserId,
      requestId: generateRequestId(),
    })
    if (!result.success) {
      throw new WorkflowImportError(importErrorCode(result.status), result.error, result.details)
    }
    return {
      workflow: result.workflow,
      folderPath: workflowFolderPathForId(resolution.index, result.workflow.folderId),
    }
  },
  projectAudit({ result }) {
    return {
      action: AuditAction.WORKFLOW_CREATED,
      resourceType: AuditResourceType.WORKFLOW,
      resourceId: result.workflow.id,
      resourceName: result.workflow.name,
      description: `Created workflow "${result.workflow.name}"`,
      metadata: {
        name: result.workflow.name,
        description: result.workflow.description || undefined,
        workspaceId: result.workflow.workspaceId,
        folderId: result.workflow.folderId || undefined,
        sortOrder: result.workflow.sortOrder,
        blocksCount: result.workflow.blocks.length,
      },
    }
  },
})

export const exportWorkflow = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.export,
  resolveContext: ({ input }: { input: ExportWorkflowInput }) =>
    resolveActiveWorkflowApplicationContext({ workflowId: input.workflowId }),
  async execute({ context }): Promise<ExportWorkflowResult> {
    const payload = await buildWorkflowExportPayload(context.workflow)
    if (!payload) throw new OrchestrationError('not_found', 'Workflow state not found')
    const folderIndex = await loadActiveFolderPathIndex(
      context.workspaceId,
      'workflow',
      undefined,
      { maxRows: MAX_FOLDERS_PER_WORKSPACE }
    )
    return {
      payload,
      folderPath: workflowFolderPathForId(folderIndex, context.workflow.folderId),
    }
  },
  projectAudit({ context, result }) {
    return {
      action: AuditAction.WORKFLOW_EXPORTED,
      resourceType: AuditResourceType.WORKFLOW,
      resourceId: context.workflow.id,
      resourceName: context.workflow.name,
      description: `Exported workflow "${context.workflow.name}" via the API`,
      metadata: {
        workspaceId: context.workspaceId,
        folderPath: result.folderPath,
        blocksCount: Object.keys(result.payload.state.blocks).length,
        edgesCount: result.payload.state.edges.length,
      },
    }
  },
})
