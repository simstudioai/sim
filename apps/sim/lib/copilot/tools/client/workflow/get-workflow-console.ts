import { Loader2, MinusCircle, TerminalSquare, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { ExecuteResponseSuccessSchema } from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface GetWorkflowConsoleArgs {
  workflowId?: string
  limit?: number
  includeDetails?: boolean
}

export class GetWorkflowConsoleClientTool extends BaseClientTool {
  static readonly id = 'get_workflow_console'

  constructor(toolCallId: string) {
    super(toolCallId, GetWorkflowConsoleClientTool.id, GetWorkflowConsoleClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Fetching workflow console', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Fetching workflow console', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Workflow console fetched', icon: TerminalSquare },
      [ClientToolCallState.error]: { text: 'Failed to read workflow console', icon: XCircle },
      [ClientToolCallState.rejected]: {
        text: 'Skipped reading workflow console',
        icon: MinusCircle,
      },
      [ClientToolCallState.aborted]: {
        text: 'Aborted reading workflow console',
        icon: MinusCircle,
      },
      [ClientToolCallState.pending]: { text: 'Fetching workflow console', icon: Loader2 },
    },
  }

  async execute(args?: GetWorkflowConsoleArgs): Promise<void> {
    const logger = createLogger('GetWorkflowConsoleClientTool')
    try {
      this.setState(ClientToolCallState.executing)

      const params = args || {}
      let workflowId = params.workflowId
      if (!workflowId) {
        const { activeWorkflowId } = useWorkflowRegistry.getState()
        workflowId = activeWorkflowId || undefined
      }
      if (!workflowId) {
        logger.error('No active workflow found for console fetch')
        this.setState(ClientToolCallState.error)
        await this.markToolComplete(400, 'No active workflow found')
        return
      }

      const payload = {
        workflowId,
        limit: params.limit ?? 3,
        includeDetails: params.includeDetails ?? true,
      }

      const res = await fetch('/api/copilot/execute-copilot-server-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: 'get_workflow_console', payload }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `Server error (${res.status})`)
      }

      const json = await res.json()
      const parsed = ExecuteResponseSuccessSchema.parse(json)

      // Mark success and include result data for UI rendering
      this.setState(ClientToolCallState.success)
      await this.markToolComplete(200, 'Workflow console fetched', parsed.result)
      this.setState(ClientToolCallState.success)
    } catch (e: any) {
      const message = e instanceof Error ? e.message : String(e)
      createLogger('GetWorkflowConsoleClientTool').error('execute failed', { message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, message)
    }
  }
}
