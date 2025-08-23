import { KeyRound, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { ExecuteResponseSuccessSchema } from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface GetEnvArgs {
  userId?: string
  workflowId?: string
}

export class GetEnvironmentVariablesClientTool extends BaseClientTool {
  static readonly id = 'get_environment_variables'

  constructor(toolCallId: string) {
    super(
      toolCallId,
      GetEnvironmentVariablesClientTool.id,
      GetEnvironmentVariablesClientTool.metadata
    )
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: {
        text: 'Reading environment variables',
        icon: Loader2,
      },
      [ClientToolCallState.pending]: { text: 'Reading environment variables', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Reading environment variables', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Read environment variables', icon: KeyRound },
      [ClientToolCallState.error]: { text: 'Failed to read environment variables', icon: XCircle },
      [ClientToolCallState.aborted]: {
        text: 'Aborted reading environment variables',
        icon: MinusCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped reading environment variables',
        icon: MinusCircle,
      },
    },
  }

  async execute(args?: GetEnvArgs): Promise<void> {
    const logger = createLogger('GetEnvironmentVariablesClientTool')
    try {
      this.setState(ClientToolCallState.executing)
      const payload: GetEnvArgs = { ...(args || {}) }
      if (!payload.workflowId) {
        const { activeWorkflowId } = useWorkflowRegistry.getState()
        if (activeWorkflowId) payload.workflowId = activeWorkflowId
      }
      const res = await fetch('/api/copilot/execute-copilot-server-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: 'get_environment_variables', payload }),
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        throw new Error(txt || `Server error (${res.status})`)
      }
      const json = await res.json()
      const parsed = ExecuteResponseSuccessSchema.parse(json)
      this.setState(ClientToolCallState.success)
      await this.markToolComplete(200, 'Environment variables fetched', parsed.result)
      this.setState(ClientToolCallState.success)
    } catch (e: any) {
      logger.error('execute failed', { message: e?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, e?.message || 'Failed to get environment variables')
    }
  }
}
