import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { applyAutoLayout } from '@/lib/workflows/autolayout'
import { extractAndPersistCustomTools } from '@/lib/workflows/persistence/custom-tools-persistence'
import {
  loadWorkflowFromNormalizedTables,
  saveWorkflowToNormalizedTables,
} from '@/lib/workflows/persistence/utils'
import { validateWorkflowState } from '@/lib/workflows/sanitization/validation'
import { authorizeWorkflowByWorkspacePermission } from '@/lib/workflows/utils'
import { getUserPermissionConfig } from '@/ee/access-control/utils/permission-check'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'
import { applyOperationsToWorkflowState } from './engine'
import type { EditWorkflowParams, ValidationError } from './types'
import { preValidateCredentialInputs, validateWorkflowSelectorIds } from './validation'

async function getCurrentWorkflowStateFromDb(
  workflowId: string
): Promise<{ workflowState: any; subBlockValues: Record<string, Record<string, any>> }> {
  const logger = createLogger('EditWorkflowServerTool')
  const [workflowRecord] = await db
    .select()
    .from(workflowTable)
    .where(eq(workflowTable.id, workflowId))
    .limit(1)
  if (!workflowRecord) throw new Error(`Workflow ${workflowId} not found in database`)
  const normalized = await loadWorkflowFromNormalizedTables(workflowId)
  if (!normalized) throw new Error('Workflow has no normalized data')

  // Validate and fix blocks without types
  const blocks = { ...normalized.blocks }
  const invalidBlocks: string[] = []

  Object.entries(blocks).forEach(([id, block]: [string, any]) => {
    if (!block.type) {
      logger.warn(`Block ${id} loaded without type from database`, {
        blockKeys: Object.keys(block),
        blockName: block.name,
      })
      invalidBlocks.push(id)
    }
  })

  // Remove invalid blocks
  invalidBlocks.forEach((id) => delete blocks[id])

  // Remove edges connected to invalid blocks
  const edges = normalized.edges.filter(
    (edge: any) => !invalidBlocks.includes(edge.source) && !invalidBlocks.includes(edge.target)
  )

  const workflowState: any = {
    blocks,
    edges,
    loops: normalized.loops || {},
    parallels: normalized.parallels || {},
  }
  const subBlockValues: Record<string, Record<string, any>> = {}
  Object.entries(normalized.blocks).forEach(([blockId, block]) => {
    subBlockValues[blockId] = {}
    Object.entries((block as any).subBlocks || {}).forEach(([subId, sub]) => {
      if ((sub as any).value !== undefined) subBlockValues[blockId][subId] = (sub as any).value
    })
  })
  return { workflowState, subBlockValues }
}

export const editWorkflowServerTool: BaseServerTool<EditWorkflowParams, unknown> = {
  name: 'edit_workflow',
  async execute(params: EditWorkflowParams, context?: { userId: string }): Promise<unknown> {
    const logger = createLogger('EditWorkflowServerTool')
    const { operations, workflowId, currentUserWorkflow } = params
    if (!Array.isArray(operations) || operations.length === 0) {
      throw new Error('operations are required and must be an array')
    }
    if (!workflowId) throw new Error('workflowId is required')
    if (!context?.userId) {
      throw new Error('Unauthorized workflow access')
    }

    const authorization = await authorizeWorkflowByWorkspacePermission({
      workflowId,
      userId: context.userId,
      action: 'write',
    })
    if (!authorization.allowed) {
      throw new Error(authorization.message || 'Unauthorized workflow access')
    }

    logger.info('Executing edit_workflow', {
      operationCount: operations.length,
      workflowId,
      hasCurrentUserWorkflow: !!currentUserWorkflow,
    })

    // Get current workflow state
    let workflowState: any
    if (currentUserWorkflow) {
      try {
        workflowState = JSON.parse(currentUserWorkflow)
      } catch (error) {
        logger.error('Failed to parse currentUserWorkflow', error)
        throw new Error('Invalid currentUserWorkflow format')
      }
    } else {
      const fromDb = await getCurrentWorkflowStateFromDb(workflowId)
      workflowState = fromDb.workflowState
    }

    // Get permission config for the user
    const permissionConfig = context?.userId ? await getUserPermissionConfig(context.userId) : null

    // Pre-validate credential and apiKey inputs before applying operations
    // This filters out invalid credentials and apiKeys for hosted models
    let operationsToApply = operations
    const credentialErrors: ValidationError[] = []
    if (context?.userId) {
      const { filteredOperations, errors: credErrors } = await preValidateCredentialInputs(
        operations,
        { userId: context.userId },
        workflowState
      )
      operationsToApply = filteredOperations
      credentialErrors.push(...credErrors)
    }

    // Apply operations directly to the workflow state
    const {
      state: modifiedWorkflowState,
      validationErrors,
      skippedItems,
    } = applyOperationsToWorkflowState(workflowState, operationsToApply, permissionConfig)

    // Add credential validation errors
    validationErrors.push(...credentialErrors)

    // Get workspaceId for selector validation
    let workspaceId: string | undefined
    try {
      const [workflowRecord] = await db
        .select({ workspaceId: workflowTable.workspaceId })
        .from(workflowTable)
        .where(eq(workflowTable.id, workflowId))
        .limit(1)
      workspaceId = workflowRecord?.workspaceId ?? undefined
    } catch (error) {
      logger.warn('Failed to get workspaceId for selector validation', { error, workflowId })
    }

    // Validate selector IDs exist in the database
    if (context?.userId) {
      try {
        const selectorErrors = await validateWorkflowSelectorIds(modifiedWorkflowState, {
          userId: context.userId,
          workspaceId,
        })
        validationErrors.push(...selectorErrors)
      } catch (error) {
        logger.warn('Selector ID validation failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Validate the workflow state
    const validation = validateWorkflowState(modifiedWorkflowState, { sanitize: true })

    if (!validation.valid) {
      logger.error('Edited workflow state is invalid', {
        errors: validation.errors,
        warnings: validation.warnings,
      })
      throw new Error(`Invalid edited workflow: ${validation.errors.join('; ')}`)
    }

    if (validation.warnings.length > 0) {
      logger.warn('Edited workflow validation warnings', {
        warnings: validation.warnings,
      })
    }

    // Extract and persist custom tools to database (reuse workspaceId from selector validation)
    if (context?.userId && workspaceId) {
      try {
        const finalWorkflowState = validation.sanitizedState || modifiedWorkflowState
        const { saved, errors } = await extractAndPersistCustomTools(
          finalWorkflowState,
          workspaceId,
          context.userId
        )

        if (saved > 0) {
          logger.info(`Persisted ${saved} custom tool(s) to database`, { workflowId })
        }

        if (errors.length > 0) {
          logger.warn('Some custom tools failed to persist', { errors, workflowId })
        }
      } catch (error) {
        logger.error('Failed to persist custom tools', { error, workflowId })
      }
    } else if (context?.userId && !workspaceId) {
      logger.warn('Workflow has no workspaceId, skipping custom tools persistence', {
        workflowId,
      })
    } else {
      logger.warn('No userId in context - skipping custom tools persistence', { workflowId })
    }

    logger.info('edit_workflow successfully applied operations', {
      operationCount: operations.length,
      blocksCount: Object.keys(modifiedWorkflowState.blocks).length,
      edgesCount: modifiedWorkflowState.edges.length,
      inputValidationErrors: validationErrors.length,
      skippedItemsCount: skippedItems.length,
      schemaValidationErrors: validation.errors.length,
      validationWarnings: validation.warnings.length,
    })

    // Format validation errors for LLM feedback
    const inputErrors =
      validationErrors.length > 0
        ? validationErrors.map((e) => `Block "${e.blockId}" (${e.blockType}): ${e.error}`)
        : undefined

    // Format skipped items for LLM feedback
    const skippedMessages =
      skippedItems.length > 0 ? skippedItems.map((item) => item.reason) : undefined

    // Persist the workflow state to the database
    const finalWorkflowState = validation.sanitizedState || modifiedWorkflowState

    // Apply autolayout to position blocks properly
    const layoutResult = applyAutoLayout(finalWorkflowState.blocks, finalWorkflowState.edges, {
      horizontalSpacing: 250,
      verticalSpacing: 100,
      padding: { x: 100, y: 100 },
    })

    const layoutedBlocks =
      layoutResult.success && layoutResult.blocks ? layoutResult.blocks : finalWorkflowState.blocks

    if (!layoutResult.success) {
      logger.warn('Autolayout failed, using default positions', {
        workflowId,
        error: layoutResult.error,
      })
    }

    const workflowStateForDb = {
      blocks: layoutedBlocks,
      edges: finalWorkflowState.edges,
      loops: generateLoopBlocks(layoutedBlocks as any),
      parallels: generateParallelBlocks(layoutedBlocks as any),
      lastSaved: Date.now(),
      isDeployed: false,
    }

    const saveResult = await saveWorkflowToNormalizedTables(workflowId, workflowStateForDb as any)
    if (!saveResult.success) {
      logger.error('Failed to persist workflow state to database', {
        workflowId,
        error: saveResult.error,
      })
      throw new Error(`Failed to save workflow: ${saveResult.error}`)
    }

    // Update workflow's lastSynced timestamp
    await db
      .update(workflowTable)
      .set({
        lastSynced: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(workflowTable.id, workflowId))

    logger.info('Workflow state persisted to database', { workflowId })

    // Return the modified workflow state with autolayout applied
    return {
      success: true,
      workflowState: { ...finalWorkflowState, blocks: layoutedBlocks },
      // Include input validation errors so the LLM can see what was rejected
      ...(inputErrors && {
        inputValidationErrors: inputErrors,
        inputValidationMessage: `${inputErrors.length} input(s) were rejected due to validation errors. The workflow was still updated with valid inputs only. Errors: ${inputErrors.join('; ')}`,
      }),
      // Include skipped items so the LLM can see what operations were skipped
      ...(skippedMessages && {
        skippedItems: skippedMessages,
        skippedItemsMessage: `${skippedItems.length} operation(s) were skipped due to invalid references. Details: ${skippedMessages.join('; ')}`,
      }),
    }
  },
}
