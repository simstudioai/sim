import { Grid2x2, Grid2x2Check, Grid2x2X, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { ExecuteResponseSuccessSchema } from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

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

  constructor(toolCallId: string) {
    super(toolCallId, EditWorkflowClientTool.id, EditWorkflowClientTool.metadata)
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
  }

  async handleAccept(): Promise<void> {
    const logger = createLogger('EditWorkflowClientTool')
    logger.info('handleAccept called', {
      toolCallId: this.toolCallId,
      state: this.getState(),
      hasResult: this.lastResult !== undefined,
    })
    this.setState(ClientToolCallState.success)
    await this.markToolComplete(200, 'Workflow edits accepted', this.lastResult)
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
          let merged = fullState
          if (merged?.blocks) {
            merged = { ...merged, blocks: mergeSubblockState(merged.blocks, workflowId as any) }
          }
          if (merged) {
            if (!merged.loops) merged.loops = {}
            if (!merged.parallels) merged.parallels = {}
            if (!merged.edges) merged.edges = []
            if (!merged.blocks) merged.blocks = {}
            currentUserWorkflow = JSON.stringify(merged)
          }
        } catch (e) {
          logger.warn(
            'Failed to build currentUserWorkflow from stores; proceeding without it',
            e as any
          )
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
        throw new Error(errorText || `Server error (${res.status})`)
      }

      const json = await res.json()
      const parsed = ExecuteResponseSuccessSchema.parse(json)
      const result = parsed.result as any
      this.lastResult = result
      logger.info('server result parsed', {
        hasYaml: !!result?.yamlContent,
        yamlLength: (result?.yamlContent || '').length,
      })

      // Update diff via YAML so colors/highlights persist
      try {
        if (!this.hasAppliedDiff) {
          const diffStore = useWorkflowDiffStore.getState()
          // Send early stats upsert with the triggering user message id if available
          try {
            const { useCopilotStore } = await import('@/stores/copilot/store')
            const { currentChat, currentUserMessageId, agentDepth, agentPrefetch } =
              useCopilotStore.getState() as any
            if (currentChat?.id && currentUserMessageId) {
              fetch('/api/copilot/stats', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chatId: currentChat.id,
                  messageId: currentUserMessageId,
                  depth: agentDepth,
                  maxEnabled: agentDepth >= 2 && !agentPrefetch,
                  diffCreated: true,
                }),
              }).catch(() => {})
            }
          } catch {}
          await diffStore.setProposedChanges(result.yamlContent)
          logger.info('diff proposed changes set for edit_workflow')
          this.hasAppliedDiff = true
        } else {
          logger.info('skipping diff apply (already applied)')
        }
      } catch (e) {
        logger.warn('Failed to set proposed changes in diff store', e as any)
      }

      // Mark complete early to unblock LLM stream
      await this.markToolComplete(200, 'Workflow diff ready for review', result)

      // Move into review state
      this.setState(ClientToolCallState.review, { result })
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('execute error', { message })
      this.setState(ClientToolCallState.error)
    }
  }
}
