import { ListChecks, Loader2, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('ListUserWorkflowsClientTool')

export class ListUserWorkflowsClientTool extends BaseClientTool {
  static readonly id = 'list_user_workflows'

  constructor(toolCallId: string) {
    super(toolCallId, ListUserWorkflowsClientTool.id, ListUserWorkflowsClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Listing your workflows', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Listing your workflows', icon: ListChecks },
      [ClientToolCallState.executing]: { text: 'Listing your workflows', icon: Loader2 },
      [ClientToolCallState.aborted]: { text: 'Aborted listing workflows', icon: XCircle },
      [ClientToolCallState.success]: { text: 'Listed your workflows', icon: ListChecks },
      [ClientToolCallState.error]: { text: 'Failed to list workflows', icon: X },
      [ClientToolCallState.rejected]: { text: 'Skipped listing workflows', icon: XCircle },
    },
  }

  async execute(): Promise<void> {
    try {
      this.setState(ClientToolCallState.executing)

      const res = await fetch('/api/workflows/sync', { method: 'GET' })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        await this.markToolComplete(res.status, text || 'Failed to fetch workflows')
        this.setState(ClientToolCallState.error)
        return
      }

      const json = await res.json()
      const workflows = Array.isArray(json?.data) ? json.data : []
      const names = workflows
        .map((w: any) => (typeof w?.name === 'string' ? w.name : null))
        .filter((n: string | null) => !!n)

      logger.info('Found workflows', { count: names.length })

      await this.markToolComplete(200, `Found ${names.length} workflow(s)`, {
        workflow_names: names,
      })
      this.setState(ClientToolCallState.success)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      await this.markToolComplete(500, message || 'Failed to list workflows')
      this.setState(ClientToolCallState.error)
    }
  }
}
