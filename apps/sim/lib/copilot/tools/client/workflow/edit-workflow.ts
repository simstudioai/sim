import { createLogger } from '@sim/logger'
import { Grid2x2, Grid2x2Check, Grid2x2X, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { registerToolUIConfig } from '@/lib/copilot/tools/client/ui-config'
import { ExecuteResponseSuccessSchema } from '@/lib/copilot/tools/shared/schemas'
import { stripWorkflowDiffMarkers } from '@/lib/workflows/diff'
import { sanitizeForCopilot } from '@/lib/workflows/sanitization/json-sanitizer'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

interface EditWorkflowOperation {
  operation_type: 'add' | 'edit' | 'delete'
  block_id: string
  params?: Record<string, any>
}

interface EditWorkflowArgs {
  operations: EditWorkflowOperation[]
  workflowId: string
  currentUserWorkflow?: string
}

export class EditWorkflowClientTool extends BaseClientTool {
  static readonly id = 'edit_workflow'
  private lastResult: any | undefined
  private hasExecuted = false
  private hasAppliedDiff = false
  private workflowId: string | undefined

  constructor(toolCallId: string) {
    super(toolCallId, EditWorkflowClientTool.id, EditWorkflowClientTool.metadata)
  }

  async markToolComplete(status: number, message?: any, data?: any): Promise<boolean> {
    const logger = createLogger('EditWorkflowClientTool')
    logger.info('markToolComplete payload', {
      toolCallId: this.toolCallId,
      toolName: this.name,
      status,
      message,
      data,
    })
    return super.markToolComplete(status, message, data)
  }

  /**
   * Get sanitized workflow JSON from a workflow state, merge subblocks, and sanitize for copilot
   * This matches what get_user_workflow returns
   */
  private getSanitizedWorkflowJson(workflowState: any): string | undefined {
    const logger = createLogger('EditWorkflowClientTool')

    if (!this.workflowId) {
      logger.warn('No workflowId available for getting sanitized workflow JSON')
      return undefined
    }

    if (!workflowState) {
      logger.warn('No workflow state provided')
      return undefined
    }

    try {
      // Normalize required properties
      if (!workflowState.loops) workflowState.loops = {}
      if (!workflowState.parallels) workflowState.parallels = {}
      if (!workflowState.edges) workflowState.edges = []
      if (!workflowState.blocks) workflowState.blocks = {}

      // Merge latest subblock values so edits are reflected
      let mergedState = workflowState
      if (workflowState.blocks) {
        mergedState = {
          ...workflowState,
          blocks: mergeSubblockState(workflowState.blocks, this.workflowId as any),
        }
        logger.info('Merged subblock values into workflow state', {
          workflowId: this.workflowId,
          blockCount: Object.keys(mergedState.blocks || {}).length,
        })
      }

      // Sanitize workflow state for copilot (remove UI-specific data)
      const sanitizedState = sanitizeForCopilot(mergedState)

      // Convert to JSON string for transport
      const workflowJson = JSON.stringify(sanitizedState, null, 2)
      logger.info('Successfully created sanitized workflow JSON', {
        workflowId: this.workflowId,
        jsonLength: workflowJson.length,
      })

      return workflowJson
    } catch (error) {
      logger.error('Failed to get sanitized workflow JSON', {
        error: error instanceof Error ? error.message : String(error),
      })
      return undefined
    }
  }

  /**
   * Safely get the current workflow JSON sanitized for copilot without throwing.
   * Used to ensure we always include workflow state in markComplete.
   */
  private getCurrentWorkflowJsonSafe(logger: ReturnType<typeof createLogger>): string | undefined {
    try {
      const currentState = useWorkflowStore.getState().getWorkflowState()
      if (!currentState) {
        logger.warn('No current workflow state available')
        return undefined
      }
      return this.getSanitizedWorkflowJson(currentState)
    } catch (error) {
      logger.warn('Failed to get current workflow JSON safely', {
        error: error instanceof Error ? error.message : String(error),
      })
      return undefined
    }
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Editing your workflow', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Editing your workflow', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Edited your workflow', icon: Grid2x2Check },
      [ClientToolCallState.error]: { text: 'Failed to edit your workflow', icon: XCircle },
      [ClientToolCallState.review]: { text: 'Review your workflow changes', icon: Grid2x2 },
      [ClientToolCallState.rejected]: { text: 'Rejected workflow changes', icon: Grid2x2X },
      [ClientToolCallState.aborted]: { text: 'Aborted editing your workflow', icon: MinusCircle },
      [ClientToolCallState.pending]: { text: 'Editing your workflow', icon: Loader2 },
    },
    uiConfig: {
      isSpecial: true,
      customRenderer: 'edit_summary',
    },
    getDynamicText: (params, state) => {
      const workflowId = params?.workflowId || useWorkflowRegistry.getState().activeWorkflowId
      if (workflowId) {
        const workflowName = useWorkflowRegistry.getState().workflows[workflowId]?.name
        if (workflowName) {
          switch (state) {
            case ClientToolCallState.success:
              return `Edited ${workflowName}`
            case ClientToolCallState.executing:
            case ClientToolCallState.generating:
            case ClientToolCallState.pending:
              return `Editing ${workflowName}`
            case ClientToolCallState.error:
              return `Failed to edit ${workflowName}`
            case ClientToolCallState.review:
              return `Review changes to ${workflowName}`
            case ClientToolCallState.rejected:
              return `Rejected changes to ${workflowName}`
            case ClientToolCallState.aborted:
              return `Aborted editing ${workflowName}`
          }
        }
      }
      return undefined
    },
  }

  async handleAccept(): Promise<void> {
    const logger = createLogger('EditWorkflowClientTool')
    logger.info('handleAccept called', { toolCallId: this.toolCallId, state: this.getState() })
    // Tool was already marked complete in execute() - this is just for UI state
    this.setState(ClientToolCallState.success)
  }

  async handleReject(): Promise<void> {
    const logger = createLogger('EditWorkflowClientTool')
    logger.info('handleReject called', { toolCallId: this.toolCallId, state: this.getState() })
    // Tool was already marked complete in execute() - this is just for UI state
    this.setState(ClientToolCallState.rejected)
  }

  async execute(args?: EditWorkflowArgs): Promise<void> {
    const logger = createLogger('EditWorkflowClientTool')

    if (this.hasExecuted) {
      logger.info('execute skipped (already executed)', { toolCallId: this.toolCallId })
      return
    }

    // Use timeout protection to ensure tool always completes
    await this.executeWithTimeout(async () => {
      this.hasExecuted = true
      logger.info('execute called', { toolCallId: this.toolCallId, argsProvided: !!args })
      this.setState(ClientToolCallState.executing)

      // Resolve workflowId
      let workflowId = args?.workflowId
      if (!workflowId) {
        const { activeWorkflowId } = useWorkflowRegistry.getState()
        workflowId = activeWorkflowId as any
      }
      if (!workflowId) {
        this.setState(ClientToolCallState.error)
        await this.markToolComplete(400, 'No active workflow found')
        return
      }

      // Store workflowId for later use
      this.workflowId = workflowId

      // Validate operations
      const operations = args?.operations || []
      if (!operations.length) {
        this.setState(ClientToolCallState.error)
        const currentWorkflowJson = this.getCurrentWorkflowJsonSafe(logger)
        await this.markToolComplete(
          400,
          'No operations provided for edit_workflow',
          currentWorkflowJson ? { userWorkflow: currentWorkflowJson } : undefined
        )
        return
      }

      // Prepare currentUserWorkflow JSON from stores to preserve block IDs
      let currentUserWorkflow = args?.currentUserWorkflow

      if (!currentUserWorkflow) {
        try {
          const workflowStore = useWorkflowStore.getState()
          const fullState = workflowStore.getWorkflowState()
          const mergedBlocks = mergeSubblockState(fullState.blocks, workflowId as any)
          const payloadState = stripWorkflowDiffMarkers({
            ...fullState,
            blocks: mergedBlocks,
            edges: fullState.edges || [],
            loops: fullState.loops || {},
            parallels: fullState.parallels || {},
          })
          currentUserWorkflow = JSON.stringify(payloadState)
        } catch (error) {
          logger.warn('Failed to build currentUserWorkflow from stores; proceeding without it', {
            error,
          })
        }
      }

      // Fetch with AbortController for timeout support
      const controller = new AbortController()
      const fetchTimeout = setTimeout(() => controller.abort(), 60000) // 60s fetch timeout

      try {
        const res = await fetch('/api/copilot/execute-copilot-server-tool', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            toolName: 'edit_workflow',
            payload: {
              operations,
              workflowId,
              ...(currentUserWorkflow ? { currentUserWorkflow } : {}),
            },
          }),
          signal: controller.signal,
        })

        clearTimeout(fetchTimeout)

        if (!res.ok) {
          const errorText = await res.text().catch(() => '')
          let errorMessage: string
          try {
            const errorJson = JSON.parse(errorText)
            errorMessage = errorJson.error || errorText || `Server error (${res.status})`
          } catch {
            errorMessage = errorText || `Server error (${res.status})`
          }
          // Mark complete with error but include current workflow state
          this.setState(ClientToolCallState.error)
          const currentWorkflowJson = this.getCurrentWorkflowJsonSafe(logger)
          await this.markToolComplete(
            res.status,
            errorMessage,
            currentWorkflowJson ? { userWorkflow: currentWorkflowJson } : undefined
          )
          return
        }

        const json = await res.json()
        const parsed = ExecuteResponseSuccessSchema.parse(json)
        const result = parsed.result as any
        this.lastResult = result
        logger.info('server result parsed', {
          hasWorkflowState: !!result?.workflowState,
          blocksCount: result?.workflowState
            ? Object.keys(result.workflowState.blocks || {}).length
            : 0,
          hasSkippedItems: !!result?.skippedItems,
          skippedItemsCount: result?.skippedItems?.length || 0,
          hasInputValidationErrors: !!result?.inputValidationErrors,
          inputValidationErrorsCount: result?.inputValidationErrors?.length || 0,
        })

        // Log skipped items and validation errors for visibility
        if (result?.skippedItems?.length > 0) {
          logger.warn('Some operations were skipped during edit_workflow', {
            skippedItems: result.skippedItems,
          })
        }
        if (result?.inputValidationErrors?.length > 0) {
          logger.warn('Some inputs were rejected during edit_workflow', {
            inputValidationErrors: result.inputValidationErrors,
          })
        }

        // Update diff directly with workflow state - no YAML conversion needed!
        if (!result.workflowState) {
          this.setState(ClientToolCallState.error)
          const currentWorkflowJson = this.getCurrentWorkflowJsonSafe(logger)
          await this.markToolComplete(
            500,
            'No workflow state returned from server',
            currentWorkflowJson ? { userWorkflow: currentWorkflowJson } : undefined
          )
          return
        }

        let actualDiffWorkflow: WorkflowState | null = null

        if (!this.hasAppliedDiff) {
          const diffStore = useWorkflowDiffStore.getState()
          // setProposedChanges applies the state optimistically to the workflow store
          await diffStore.setProposedChanges(result.workflowState)
          logger.info('diff proposed changes set for edit_workflow with direct workflow state')
          this.hasAppliedDiff = true
        }

        // Read back the applied state from the workflow store
        const workflowStore = useWorkflowStore.getState()
        actualDiffWorkflow = workflowStore.getWorkflowState()

        if (!actualDiffWorkflow) {
          this.setState(ClientToolCallState.error)
          const currentWorkflowJson = this.getCurrentWorkflowJsonSafe(logger)
          await this.markToolComplete(
            500,
            'Failed to retrieve workflow state after applying changes',
            currentWorkflowJson ? { userWorkflow: currentWorkflowJson } : undefined
          )
          return
        }

        // Get the workflow state that was just applied, merge subblocks, and sanitize
        // This matches what get_user_workflow would return (the true state after edits were applied)
        let workflowJson = this.getSanitizedWorkflowJson(actualDiffWorkflow)

        // Fallback: try to get current workflow state if sanitization failed
        if (!workflowJson) {
          workflowJson = this.getCurrentWorkflowJsonSafe(logger)
        }

        // userWorkflow must always be present on success - log error if missing
        if (!workflowJson) {
          logger.error('Failed to get workflow JSON on success path - this should not happen', {
            toolCallId: this.toolCallId,
            workflowId: this.workflowId,
          })
        }

        // Build sanitized data including workflow JSON and any skipped/validation info
        // Always include userWorkflow on success paths
        const sanitizedData: Record<string, any> = {
          userWorkflow: workflowJson ?? '{}', // Fallback to empty object JSON if all else fails
        }

        // Include skipped items and validation errors in the response for LLM feedback
        if (result?.skippedItems?.length > 0) {
          sanitizedData.skippedItems = result.skippedItems
          sanitizedData.skippedItemsMessage = result.skippedItemsMessage
        }
        if (result?.inputValidationErrors?.length > 0) {
          sanitizedData.inputValidationErrors = result.inputValidationErrors
          sanitizedData.inputValidationMessage = result.inputValidationMessage
        }

        // Build a message that includes info about skipped items
        let completeMessage = 'Workflow diff ready for review'
        if (result?.skippedItems?.length > 0 || result?.inputValidationErrors?.length > 0) {
          const parts: string[] = []
          if (result?.skippedItems?.length > 0) {
            parts.push(`${result.skippedItems.length} operation(s) skipped`)
          }
          if (result?.inputValidationErrors?.length > 0) {
            parts.push(`${result.inputValidationErrors.length} input(s) rejected`)
          }
          completeMessage = `Workflow diff ready for review. Note: ${parts.join(', ')}.`
        }

        // Mark complete early to unblock LLM stream - sanitizedData always has userWorkflow
        await this.markToolComplete(200, completeMessage, sanitizedData)

        // Move into review state
        this.setState(ClientToolCallState.review, { result })
      } catch (fetchError: any) {
        clearTimeout(fetchTimeout)
        // Handle error with current workflow state
        this.setState(ClientToolCallState.error)
        const currentWorkflowJson = this.getCurrentWorkflowJsonSafe(logger)
        const errorMessage =
          fetchError.name === 'AbortError'
            ? 'Server request timed out'
            : fetchError.message || String(fetchError)
        await this.markToolComplete(
          500,
          errorMessage,
          currentWorkflowJson ? { userWorkflow: currentWorkflowJson } : undefined
        )
      }
    })
  }
}

// Register UI config at module load
registerToolUIConfig(EditWorkflowClientTool.id, EditWorkflowClientTool.metadata.uiConfig!)
