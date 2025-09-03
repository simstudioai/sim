import { Grid2x2, Grid2x2Check, Grid2x2X, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import {
  BuildWorkflowInput,
  BuildWorkflowResult,
  ExecuteResponseSuccessSchema,
} from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'

interface BuildWorkflowArgs {
  yamlContent: string
  description?: string
}

export class BuildWorkflowClientTool extends BaseClientTool {
  static readonly id = 'build_workflow'
  private lastResult: any | undefined

  constructor(toolCallId: string) {
    super(toolCallId, BuildWorkflowClientTool.id, BuildWorkflowClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Building your workflow', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Building your workflow', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Built your workflow', icon: Grid2x2Check },
      [ClientToolCallState.error]: { text: 'Failed to build your workflow', icon: XCircle },
      [ClientToolCallState.review]: { text: 'Review your workflow', icon: Grid2x2 },
      [ClientToolCallState.rejected]: { text: 'Rejected workflow changes', icon: Grid2x2X },
      [ClientToolCallState.aborted]: { text: 'Aborted building your workflow', icon: MinusCircle },
      [ClientToolCallState.pending]: { text: 'Building your workflow', icon: Loader2 },
    },
  }

  async handleAccept(): Promise<void> {
    const logger = createLogger('BuildWorkflowClientTool')
    logger.info('handleAccept called', {
      toolCallId: this.toolCallId,
      state: this.getState(),
      hasResult: this.lastResult !== undefined,
    })
    this.setState(ClientToolCallState.success)
    await this.markToolComplete(200, 'Workflow accepted', this.lastResult)
    this.setState(ClientToolCallState.success)
  }

  async handleReject(): Promise<void> {
    const logger = createLogger('BuildWorkflowClientTool')
    logger.info('handleReject called', {
      toolCallId: this.toolCallId,
      state: this.getState(),
    })
    this.setState(ClientToolCallState.rejected)
    await this.markToolComplete(200, 'Workflow rejected')
  }

  async execute(args?: BuildWorkflowArgs): Promise<void> {
    const logger = createLogger('BuildWorkflowClientTool')
    try {
      logger.info('execute called', { toolCallId: this.toolCallId, argsProvided: !!args })
      this.setState(ClientToolCallState.executing)

      const { yamlContent, description } = BuildWorkflowInput.parse(args || {})
      logger.info('parsed input', {
        yamlLength: yamlContent?.length || 0,
        hasDescription: !!description,
      })

      const res = await fetch('/api/copilot/execute-copilot-server-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: 'build_workflow', payload: { yamlContent, description } }),
      })
      if (!res.ok) {
        const errorText = await res.text().catch(() => '')
        throw new Error(errorText || `Server error (${res.status})`)
      }

      const json = await res.json()
      const parsed = ExecuteResponseSuccessSchema.parse(json)
      const result = BuildWorkflowResult.parse(parsed.result)
      this.lastResult = result
      logger.info('server result parsed', {
        success: result.success,
        hasWorkflowState: !!(result as any).workflowState,
        yamlLength: result.yamlContent?.length || 0,
      })

      // Populate diff preview immediately (without marking complete yet)
      try {
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
        logger.info('diff proposed changes set')
      } catch (e) {
        const logArg: any = e
        logger.warn('Failed to set proposed changes in diff store', logArg)
      }

      // Mark complete as soon as the diff view is available so LLM stream continues
      await this.markToolComplete(200, 'Workflow diff ready for review', result)

      // Move tool into review and stash the result on the tool instance
      logger.info('setting review state')
      this.setState(ClientToolCallState.review, { result })
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('execute error', { message })
      this.setState(ClientToolCallState.error)
    }
  }
}
