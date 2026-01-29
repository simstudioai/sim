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
      }

      // Sanitize workflow state for copilot (remove UI-specific data)
      const sanitizedState = sanitizeForCopilot(mergedState)

      // Convert to JSON string for transport
      const workflowJson = JSON.stringify(sanitizedState, null, 2)

      return workflowJson
    } catch (error) {
      logger.warn('Failed to get sanitized workflow JSON', {
        error: error instanceof Error ? error.message : String(error),
      })
      return undefined
    }
  }

  private getCurrentWorkflowJsonSafe(logger: ReturnType<typeof createLogger>): string | undefined {
    try {
      const workflowStore = useWorkflowStore.getState()
      const currentState = workflowStore.getWorkflowState()
      return this.getSanitizedWorkflowJson(currentState)
    } catch {
      logger.warn('Failed to get current workflow JSON for error response')
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

  handleAccept(): void {
    const logger = createLogger('EditWorkflowClientTool')
    logger.info('handleAccept called', { toolCallId: this.toolCallId, state: this.getState() })
    // The actual accept is handled by useWorkflowDiffStore.acceptChanges()
    // This just updates the tool state
    this.setState(ClientToolCallState.success)
  }

  handleReject(): void {
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

    this.hasExecuted = true
    this.setState(ClientToolCallState.executing)

    // Get workflow ID from args or active workflow
    const workflowId = args?.workflowId || useWorkflowRegistry.getState().activeWorkflowId
    if (!workflowId) {
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(400, 'No workflow ID provided or active')
      return
    }
    this.workflowId = workflowId

    logger.info('execute starting', {
      toolCallId: this.toolCallId,
      workflowId,
      operationCount: args?.operations?.length,
    })

    try {
      // Get current workflow state to send to server
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

      // Call server to execute the tool (without saving to DB in UI mode)
      const response = await fetch('/api/copilot/execute-copilot-server-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName: 'edit_workflow',
          toolCallId: this.toolCallId,
          args: {
            ...args,
            workflowId,
            currentUserWorkflow: JSON.stringify(payloadState),
          },
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error('Server execution failed', { status: response.status, error: errorText })
        this.setState(ClientToolCallState.error)
        const currentWorkflowJson = this.getCurrentWorkflowJsonSafe(logger)
        await this.markToolComplete(
          response.status,
          errorText || 'Server execution failed',
          currentWorkflowJson ? { userWorkflow: currentWorkflowJson } : undefined
        )
        return
      }

      const result = await response.json()
      logger.info('Server execution result', {
        success: result.success,
        hasWorkflowState: !!result.data?.workflowState,
      })

      // Validate result
      const parseResult = ExecuteResponseSuccessSchema.safeParse(result)
      if (!parseResult.success || !result.data?.workflowState) {
        logger.error('Invalid response from server', { errors: parseResult.error?.errors })
        this.setState(ClientToolCallState.error)
        const currentWorkflowJson = this.getCurrentWorkflowJsonSafe(logger)
        await this.markToolComplete(
          500,
          'Invalid response from server',
          currentWorkflowJson ? { userWorkflow: currentWorkflowJson } : undefined
        )
        return
      }

      this.lastResult = result.data

      // Apply the proposed state to the diff store for review
      if (!this.hasAppliedDiff) {
        const diffStore = useWorkflowDiffStore.getState()
        // setProposedChanges applies the state optimistically to the workflow store
        // and sets up diff markers for visual feedback
        await diffStore.setProposedChanges(result.data.workflowState)
        logger.info('Diff proposed changes set for edit_workflow with direct workflow state')
        this.hasAppliedDiff = true
      }

      // Read back the applied state from the workflow store
      const actualDiffWorkflow = workflowStore.getWorkflowState()

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

      // Set state to review so user can accept/reject
      this.setState(ClientToolCallState.review)

      // Mark tool complete with success - the workflow state is ready for review
      const sanitizedJson = this.getSanitizedWorkflowJson(actualDiffWorkflow)
      await this.markToolComplete(
        200,
        result.data.inputValidationMessage || result.data.skippedItemsMessage || undefined,
        sanitizedJson ? { userWorkflow: sanitizedJson } : undefined
      )

      logger.info('execute completed successfully - awaiting user review', {
        toolCallId: this.toolCallId,
        state: this.getState(),
      })
    } catch (error) {
      logger.error('execute failed with exception', {
        toolCallId: this.toolCallId,
        error: error instanceof Error ? error.message : String(error),
      })
      this.setState(ClientToolCallState.error)
      const currentWorkflowJson = this.getCurrentWorkflowJsonSafe(logger)
      await this.markToolComplete(
        500,
        error instanceof Error ? error.message : 'Unknown error',
        currentWorkflowJson ? { userWorkflow: currentWorkflowJson } : undefined
      )
    }
  }
}

// Register UI config at module load
registerToolUIConfig(EditWorkflowClientTool.id, EditWorkflowClientTool.metadata.uiConfig!)
