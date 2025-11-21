import { Grid2x2, Grid2x2Check, Grid2x2X, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { ExecuteResponseSuccessSchema } from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'
import { stripWorkflowDiffMarkers } from '@/lib/workflows/diff'
import { sanitizeForCopilot } from '@/lib/workflows/json-sanitizer'
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
    logger.info('handleAccept called', {
      toolCallId: this.toolCallId,
      state: this.getState(),
      hasResult: this.lastResult !== undefined,
    })
    this.setState(ClientToolCallState.success)

    // Read from the workflow store to get the actual state with diff applied
    const workflowStore = useWorkflowStore.getState()
    const currentState = workflowStore.getWorkflowState()
    
    // Get the workflow state that was applied, merge subblocks, and sanitize
    // This matches what get_user_workflow would return
    const workflowJson = this.getSanitizedWorkflowJson(currentState)
    const sanitizedData = workflowJson ? { userWorkflow: workflowJson } : undefined

    await this.markToolComplete(200, 'Workflow edits accepted', sanitizedData)
    this.setState(ClientToolCallState.success)
  }

  async handleReject(): Promise<void> {
    const logger = createLogger('EditWorkflowClientTool')
    logger.info('handleReject called', { toolCallId: this.toolCallId, state: this.getState() })
    this.setState(ClientToolCallState.rejected)
    await this.markToolComplete(200, 'Workflow changes rejected')
  }

  async execute(args?: EditWorkflowArgs): Promise<void> {
    const logger = createLogger('EditWorkflowClientTool')
    try {
      if (this.hasExecuted) {
        logger.info('execute skipped (already executed)', { toolCallId: this.toolCallId })
        return
      }
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
        await this.markToolComplete(400, 'No operations provided for edit_workflow')
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
      })
      if (!res.ok) {
        const errorText = await res.text().catch(() => '')
        try {
          const errorJson = JSON.parse(errorText)
          throw new Error(errorJson.error || errorText || `Server error (${res.status})`)
        } catch {
          throw new Error(errorText || `Server error (${res.status})`)
        }
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
      })

      // Update diff directly with workflow state - no YAML conversion needed!
      // The diff engine may transform the workflow state (e.g., assign new IDs), so we must use
      // the returned proposedState rather than the original result.workflowState
      let actualDiffWorkflow: WorkflowState | null = null

      if (result.workflowState) {
        try {
          if (!this.hasAppliedDiff) {
            const diffStore = useWorkflowDiffStore.getState()
            // setProposedChanges applies the state directly to the workflow store
            await diffStore.setProposedChanges(result.workflowState)
            logger.info('diff proposed changes set for edit_workflow with direct workflow state')
            this.hasAppliedDiff = true
            
            // Read back the applied state from the workflow store
            const workflowStore = useWorkflowStore.getState()
            actualDiffWorkflow = workflowStore.getWorkflowState()
          } else {
            logger.info('skipping diff apply (already applied)')
            // If we already applied, read from workflow store
            const workflowStore = useWorkflowStore.getState()
            actualDiffWorkflow = workflowStore.getWorkflowState()
          }
        } catch (e) {
          logger.warn('Failed to set proposed changes in diff store', e as any)
          throw new Error('Failed to create workflow diff')
        }
      } else {
        throw new Error('No workflow state returned from server')
      }

      if (!actualDiffWorkflow) {
        throw new Error('Failed to retrieve workflow from diff store after setting changes')
      }

      // Get the workflow state that was just applied, merge subblocks, and sanitize
      // This matches what get_user_workflow would return (the true state after edits were applied)
      const workflowJson = this.getSanitizedWorkflowJson(actualDiffWorkflow)
      const sanitizedData = workflowJson ? { userWorkflow: workflowJson } : undefined

      // Mark complete early to unblock LLM stream
      await this.markToolComplete(200, 'Workflow diff ready for review', sanitizedData)

      // Move into review state
      this.setState(ClientToolCallState.review, { result })
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('execute error', { message })
      await this.markToolComplete(500, message)
      this.setState(ClientToolCallState.error)
    }
  }
}
