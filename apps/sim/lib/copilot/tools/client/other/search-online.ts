import { Globe, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { ExecuteResponseSuccessSchema } from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'

interface SearchOnlineArgs {
  query: string
  num?: number
  type?: string
  gl?: string
  hl?: string
}

export class SearchOnlineClientTool extends BaseClientTool {
  static readonly id = 'search_online'

  constructor(toolCallId: string) {
    super(toolCallId, SearchOnlineClientTool.id, SearchOnlineClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Searching online', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Searching online', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Searching online', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Online search complete', icon: Globe },
      [ClientToolCallState.error]: { text: 'Failed to search online', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped online search', icon: MinusCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted online search', icon: XCircle },
    },
  }

  async execute(args?: SearchOnlineArgs): Promise<void> {
    const logger = createLogger('SearchOnlineClientTool')
    try {
      this.setState(ClientToolCallState.executing)
      const res = await fetch('/api/copilot/execute-copilot-server-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: 'search_online', payload: args || {} }),
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        throw new Error(txt || `Server error (${res.status})`)
      }
      const json = await res.json()
      const parsed = ExecuteResponseSuccessSchema.parse(json)
      this.setState(ClientToolCallState.success)
      await this.markToolComplete(200, 'Online search complete', parsed.result)
      this.setState(ClientToolCallState.success)
    } catch (e: any) {
      logger.error('execute failed', { message: e?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, e?.message || 'Search failed')
    }
  }
}
