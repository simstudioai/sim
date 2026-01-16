import { createLogger } from '@sim/logger'
import { Loader2, Rocket, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

export class RedeployClientTool extends BaseClientTool {
  static readonly id = 'redeploy'
  private hasExecuted = false

  constructor(toolCallId: string) {
    super(toolCallId, RedeployClientTool.id, RedeployClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Redeploying workflow', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Redeploy workflow', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Redeploying workflow', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Redeployed workflow', icon: Rocket },
      [ClientToolCallState.error]: { text: 'Failed to redeploy workflow', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted redeploy', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped redeploy', icon: XCircle },
    },
    interrupt: undefined,
  }

  async execute(): Promise<void> {
    const logger = createLogger('RedeployClientTool')
    try {
      if (this.hasExecuted) {
        logger.info('execute skipped (already executed)', { toolCallId: this.toolCallId })
        return
      }
      this.hasExecuted = true

      this.setState(ClientToolCallState.executing)

      const { activeWorkflowId } = useWorkflowRegistry.getState()
      if (!activeWorkflowId) {
        throw new Error('No workflow ID provided')
      }

      const res = await fetch(`/api/workflows/${activeWorkflowId}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deployChatEnabled: false }),
      })

      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const errorText = json?.error || `Server error (${res.status})`
        throw new Error(errorText)
      }

      this.setState(ClientToolCallState.success)
      await this.markToolComplete(200, 'Workflow redeployed', {
        workflowId: activeWorkflowId,
        deployedAt: json?.deployedAt || null,
        schedule: json?.schedule,
      })
    } catch (error: any) {
      logger.error('Redeploy failed', { message: error?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, error?.message || 'Failed to redeploy workflow')
    }
  }
}
