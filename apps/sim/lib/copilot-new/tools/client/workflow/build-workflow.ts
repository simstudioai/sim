import { Loader2, Grid2x2, XCircle } from 'lucide-react'
import { BaseClientTool, ClientToolCallState, type BaseClientToolMetadata } from '@/lib/copilot-new/tools/client/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { ExecuteResponseSuccessSchema, BuildWorkflowInput, BuildWorkflowResult } from '@/lib/copilot-new/tools/shared/schemas'
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
      [ClientToolCallState.generating]: { text: 'Preparing to build workflow', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Building your workflow', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Built your workflow', icon: Grid2x2 },
      [ClientToolCallState.error]: { text: 'Failed to build your workflow', icon: XCircle },
    },
  }

  async handleAccept(): Promise<void> {
    // Accept → mark complete and set final state
    this.setState(ClientToolCallState.workflow_accepted)
    await this.markToolComplete(200, 'Workflow accepted', this.lastResult)
    this.setState(ClientToolCallState.success)
  }

  async handleReject(): Promise<void> {
    // Reject → mark complete and set final state
    this.setState(ClientToolCallState.workflow_rejected)
    await this.markToolComplete(200, 'Workflow rejected')
  }

  async execute(args?: BuildWorkflowArgs): Promise<void> {
    const logger = createLogger('BuildWorkflowClientTool')
    try {
      this.setState(ClientToolCallState.executing)

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
      this.lastResult = result

      // Populate diff preview immediately (without marking complete yet)
      try {
        const diffStore = useWorkflowDiffStore.getState()
        await diffStore.setProposedChanges(result.yamlContent)
      } catch (e) {
        const logArg: any = e
        logger.warn('Failed to set proposed changes in diff store', logArg)
      }

      // Move tool into review and stash the result on the tool instance
      this.setState(ClientToolCallState.review, { result })
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      this.setState(ClientToolCallState.error)
    }
  }
} 