import { Key, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { ExecuteResponseSuccessSchema } from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface GetOAuthCredentialsArgs {
  userId?: string
  workflowId?: string
}

export class GetOAuthCredentialsClientTool extends BaseClientTool {
  static readonly id = 'get_oauth_credentials'

  constructor(toolCallId: string) {
    super(toolCallId, GetOAuthCredentialsClientTool.id, GetOAuthCredentialsClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Fetching OAuth credentials', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Fetching OAuth credentials', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Retrieving login IDs', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Retrieved login IDs', icon: Key },
      [ClientToolCallState.error]: { text: 'Failed to retrieve login IDs', icon: XCircle },
      [ClientToolCallState.aborted]: {
        text: 'Aborted fetching OAuth credentials',
        icon: MinusCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped fetching OAuth credentials',
        icon: MinusCircle,
      },
    },
  }

  async execute(args?: GetOAuthCredentialsArgs): Promise<void> {
    const logger = createLogger('GetOAuthCredentialsClientTool')
    try {
      this.setState(ClientToolCallState.executing)
      const payload: GetOAuthCredentialsArgs = { ...(args || {}) }
      if (!payload.workflowId && !payload.userId) {
        const { activeWorkflowId } = useWorkflowRegistry.getState()
        if (activeWorkflowId) payload.workflowId = activeWorkflowId
      }
      const res = await fetch('/api/copilot/execute-copilot-server-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: 'get_oauth_credentials', payload }),
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        throw new Error(txt || `Server error (${res.status})`)
      }
      const json = await res.json()
      const parsed = ExecuteResponseSuccessSchema.parse(json)
      this.setState(ClientToolCallState.success)
      await this.markToolComplete(200, 'Retrieved login IDs', parsed.result)
      this.setState(ClientToolCallState.success)
    } catch (e: any) {
      logger.error('execute failed', { message: e?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, e?.message || 'Failed to retrieve login IDs')
    }
  }
}
