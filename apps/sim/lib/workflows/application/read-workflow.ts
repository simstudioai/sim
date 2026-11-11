import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  type V2WorkflowApiInputSchema,
  v2WorkflowApiInputSchema,
} from '@/lib/api/contracts/v2/workflows'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { MAX_FOLDERS_PER_WORKSPACE } from '@/lib/folders/constants'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { workflowFolderPathForId } from '@/lib/workflows/application/folders'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { resolvePrincipalWorkflowContext } from '@/lib/workflows/application/principal-scope'
import { extractInputFieldsFromBlocks } from '@/lib/workflows/input-format'
import {
  loadDeployedWorkflowState,
  NoActiveDeploymentError,
} from '@/lib/workflows/persistence/utils'
import { loadWorkflowReadSnapshot } from '@/lib/workflows/queries'
import { resolveApiRunInputSchema } from '@/lib/workflows/triggers/run-options'

const logger = createLogger('ReadWorkflow')

export interface ReadWorkflowInput {
  workflowId: string
  assertedWorkspaceId?: string
}

/**
 * JSON Schema for the `input` an API run of the active deployment accepts, or
 * null when the workflow has no active deployment or it has no API entry point.
 *
 * Read from the active version row rather than gated on the workflow's
 * `isDeployed` flag, so the two can never disagree; an undeployed workflow
 * costs one indexed lookup that finds no active version.
 *
 * Reading a workflow never depended on its deployment, so a deployment that
 * cannot be read, or a schema of an unexpected shape, reports null rather than
 * failing the read.
 */
async function loadDeployedApiInputSchema(
  workflowId: string,
  workspaceId: string
): Promise<V2WorkflowApiInputSchema | null> {
  let schema: Record<string, unknown> | null
  try {
    schema = resolveApiRunInputSchema(
      (await loadDeployedWorkflowState(workflowId, workspaceId)).blocks
    )
  } catch (error) {
    if (!(error instanceof NoActiveDeploymentError)) {
      logger.warn('Deployed input schema unavailable', {
        workflowId,
        error: getErrorMessage(error),
      })
    }
    return null
  }
  if (!schema) return null
  const parsed = v2WorkflowApiInputSchema.safeParse(schema)
  if (!parsed.success) {
    logger.warn('Deployed input schema has an unexpected shape', { workflowId })
    return null
  }
  return parsed.data
}

async function loadWorkflowFolderPath(workspaceId: string, folderId: string | null) {
  const index = await loadActiveFolderPathIndex(workspaceId, 'workflow', undefined, {
    maxRows: MAX_FOLDERS_PER_WORKSPACE,
  })
  return workflowFolderPathForId(index, folderId)
}

/** Reads canonical workflow metadata and location without loading the workflow graph. */
export const readWorkflowMetadata = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.read,
  resolveContext: resolvePrincipalWorkflowContext<ReadWorkflowInput>,
  async execute({ context }) {
    return {
      workflow: context.workflow,
      folderPath: await loadWorkflowFolderPath(context.workspaceId, context.workflow.folderId),
    }
  },
})

export const readWorkflow = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.read,
  resolveContext: resolvePrincipalWorkflowContext<ReadWorkflowInput>,
  async execute({ principal, context }) {
    const snapshot = await loadWorkflowReadSnapshot(context.workflowId, context.workspaceId)
    const workflow = snapshot.workflowRecord
    if (!workflow || workflow.archivedAt || workflow.workspaceId !== context.workspaceId) {
      throw new OrchestrationError('not_found', 'Workflow not found')
    }
    const [folderPath, inputSchema] = await Promise.all([
      loadWorkflowFolderPath(context.workspaceId, workflow.folderId),
      loadDeployedApiInputSchema(context.workflowId, context.workspaceId),
    ])
    const inputs = extractInputFieldsFromBlocks(snapshot.normalizedData?.blocks ?? {})
    logger.info('Read workflow', {
      workspaceId: context.workspaceId,
      workflowId: context.workflowId,
      principalKind: principal.kind,
    })
    return {
      workflow,
      workspaceId: context.workspaceId,
      inputs,
      inputSchema,
      folderPath,
    }
  },
})
