import { Loader2, Grid2x2, XCircle } from 'lucide-react'
import { BaseClientTool, ClientToolCallState, type BaseClientToolMetadata } from '@/lib/copilot-new/tools/client/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { useCopilotStore } from '@/stores/copilot/store'
import { ExecuteResponseSuccessSchema, BuildWorkflowInput, BuildWorkflowResult } from '@/lib/copilot-new/tools/shared/schemas'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'

interface BuildWorkflowArgs {
  yamlContent: string
  description?: string
}

export class BuildWorkflowClientTool extends BaseClientTool {
  static readonly id = 'build_workflow'

  constructor(toolCallId: string) {
    super(toolCallId, BuildWorkflowClientTool.id, BuildWorkflowClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Preparing to build workflow', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Building your workflow', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Built your workflow', icon: Grid2x2 },
      [ClientToolCallState.error]: { text: 'Failed to build your workflow', icon: XCircle },
    },
  }

  private updateStoreToolCallState(next: 'executing' | 'success' | 'errored' | 'ready_for_review', result?: any) {
    const { messages } = useCopilotStore.getState()
    const updated = messages.map((msg) => {
      const updatedToolCalls = msg.toolCalls?.map((tc) =>
        tc.id === this.toolCallId
          ? { ...tc, state: next, ...(result !== undefined ? { result } : {}) }
          : tc
      )
      const updatedBlocks = msg.contentBlocks?.map((b: any) =>
        b.type === 'tool_call' && b.toolCall?.id === this.toolCallId
          ? { ...b, toolCall: { ...b.toolCall, state: next, ...(result !== undefined ? { result } : {}) } }
          : b
      )
      return { ...msg, toolCalls: updatedToolCalls, contentBlocks: updatedBlocks }
    })
    useCopilotStore.setState({ messages: updated })
  }

  async execute(args?: BuildWorkflowArgs): Promise<void> {
    const logger = createLogger('BuildWorkflowClientTool')
    try {
      this.updateStoreToolCallState('executing')

      const { yamlContent, description } = BuildWorkflowInput.parse(args || {})

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

      // Populate diff preview immediately (without marking complete yet)
      try {
        const diffStore = useWorkflowDiffStore.getState()
        await diffStore.setProposedChanges(result.yamlContent)
      } catch (e) {
        logger.warn('Failed to set proposed changes in diff store', e)
      }

      // Move tool into ready_for_review and stash the result for later markComplete
      this.updateStoreToolCallState('review', result)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      this.updateStoreToolCallState('errored', message)
    }
  }
} 