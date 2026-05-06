import { db } from '@sim/db'
import { workflow as workflowTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { authorizeWorkflowByWorkspacePermission } from '@sim/workflow-authz'
import { eq } from 'drizzle-orm'
import { EditWorkflow } from '@/lib/copilot/generated/tool-catalog-v1'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import { env } from '@/lib/core/config/env'
import { getSocketServerUrl } from '@/lib/core/utils/urls'
import {
  applyTargetedLayout,
  getTargetedLayoutImpact,
  transferBlockHeights,
} from '@/lib/workflows/autolayout'
import {
  DEFAULT_HORIZONTAL_SPACING,
  DEFAULT_VERTICAL_SPACING,
} from '@/lib/workflows/autolayout/constants'
import { extractAndPersistCustomTools } from '@/lib/workflows/persistence/custom-tools-persistence'
import {
  loadWorkflowFromNormalizedTables,
  saveWorkflowToNormalizedTables,
} from '@/lib/workflows/persistence/utils'
import { validateWorkflowState } from '@/lib/workflows/sanitization/validation'
import { getUserPermissionConfig } from '@/ee/access-control/utils/permission-check'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'
import { normalizeWorkflowState } from '@/stores/workflows/workflow/validation'
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

  const { state: validatedState, warnings } = normalizeWorkflowState({
    blocks: normalized.blocks,
    edges: normalized.edges,
    loops: normalized.loops || {},
    parallels: normalized.parallels || {},
  })

  if (warnings.length > 0) {
    logger.warn('Normalized workflow state loaded from DB for copilot', {
      workflowId,
      warningCount: warnings.length,
      warnings,
    })
  }

  const subBlockValues: Record<string, Record<string, any>> = {}
  Object.entries(validatedState.blocks).forEach(([blockId, block]) => {
    subBlockValues[blockId] = {}
    Object.entries((block as any).subBlocks || {}).forEach(([subId, sub]) => {
      if ((sub as any).value !== undefined) subBlockValues[blockId][subId] = (sub as any).value
    })
  })
  return { workflowState: validatedState, subBlockValues }
}

export const editWorkflowServerTool: BaseServerTool<EditWorkflowParams, unknown> = {
  name: EditWorkflow.id,
  async execute(params: EditWorkflowParams, context?: ServerToolContext): Promise<unknown> {
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

    const workspaceId = authorization.workflow?.workspaceId ?? undefined
    const workflowName = authorization.workflow?.name ?? undefined

    logger.info('Executing edit_workflow', {
      operationCount: operations.length,
      workflowId,
      hasCurrentUserWorkflow: !!currentUserWorkflow,
      chatId: context.chatId,
    })

    assertServerToolNotAborted(context)

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

    const permissionConfig =
      context?.userId && workspaceId
        ? await getUserPermissionConfig(context.userId, workspaceId)
        : null

    // Pre-validate credential and apiKey inputs before applying operations
    // This filters out invalid credentials and apiKeys for hosted models
    let operationsToApply = operations
    const credentialErrors: ValidationError[] = []
    if (context?.userId) {
      const { filteredOperations, errors: credErrors } = await preValidateCredentialInputs(
        operations,
        { userId: context.userId, workspaceId },
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
          error: toError(error).message,
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
        assertServerToolNotAborted(context)
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

    const { layoutBlockIds, resizedBlockIds, shiftSourceBlockIds } = getTargetedLayoutImpact({
      before: workflowState,
      after: finalWorkflowState,
    })

    let layoutedBlocks = finalWorkflowState.blocks

    if (layoutBlockIds.length > 0 || resizedBlockIds.length > 0 || shiftSourceBlockIds.length > 0) {
      try {
        transferBlockHeights(workflowState.blocks, finalWorkflowState.blocks)
        layoutedBlocks = applyTargetedLayout(finalWorkflowState.blocks, finalWorkflowState.edges, {
          changedBlockIds: layoutBlockIds,
          resizedBlockIds,
          shiftSourceBlockIds,
          horizontalSpacing: DEFAULT_HORIZONTAL_SPACING,
          verticalSpacing: DEFAULT_VERTICAL_SPACING,
        })
      } catch (error) {
        logger.warn('Targeted autolayout failed, using default positions', {
          workflowId,
          error: toError(error).message,
        })
      }
    }

    const workflowStateForDb = {
      blocks: layoutedBlocks,
      edges: finalWorkflowState.edges,
      loops: generateLoopBlocks(layoutedBlocks as any),
      parallels: generateParallelBlocks(layoutedBlocks as any),
      lastSaved: Date.now(),
      isDeployed: false,
    }

    assertServerToolNotAborted(context)
    const saveResult = await saveWorkflowToNormalizedTables(workflowId, workflowStateForDb as any)
    if (!saveResult.success) {
      logger.error('Failed to persist workflow state to database', {
        workflowId,
        error: saveResult.error,
      })
      throw new Error(`Failed to save workflow: ${saveResult.error}`)
    }

    // Update workflow's lastSynced timestamp
    assertServerToolNotAborted(context)
    await db
      .update(workflowTable)
      .set({
        lastSynced: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(workflowTable.id, workflowId))

    logger.info('Workflow state persisted to database', { workflowId })

    fetch(`${getSocketServerUrl()}/api/workflow-updated`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.INTERNAL_API_SECRET,
      },
      body: JSON.stringify({ workflowId }),
    }).catch((error) => {
      logger.warn('Failed to notify socket server of workflow update', { workflowId, error })
    })

    const sanitizationWarnings = validation.warnings.length > 0 ? validation.warnings : undefined

    return {
      success: true,
      workflowId,
      workflowName: workflowName ?? 'Workflow',
      workflowState: { ...finalWorkflowState, blocks: layoutedBlocks },
      ...(inputErrors && {
        inputValidationErrors: inputErrors,
        inputValidationMessage: `${inputErrors.length} input(s) were rejected due to validation errors. The workflow was still updated with valid inputs only. Errors: ${inputErrors.join('; ')}`,
      }),
      ...(skippedMessages && {
        skippedItems: skippedMessages,
        skippedItemsMessage: `${skippedItems.length} operation(s) were skipped due to invalid references. Details: ${skippedMessages.join('; ')}`,
      }),
      ...(sanitizationWarnings && {
        sanitizationWarnings,
        sanitizationMessage: `${sanitizationWarnings.length} field(s) were automatically sanitized: ${sanitizationWarnings.join('; ')}`,
      }),
    }
  },
}
