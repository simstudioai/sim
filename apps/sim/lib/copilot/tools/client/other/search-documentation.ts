import { BookOpen, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { ExecuteResponseSuccessSchema } from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'

interface SearchDocumentationArgs {
  query: string
  topK?: number
  threshold?: number
}

export class SearchDocumentationClientTool extends BaseClientTool {
  static readonly id = 'search_documentation'

  constructor(toolCallId: string) {
    super(toolCallId, SearchDocumentationClientTool.id, SearchDocumentationClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Searching documentation', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Searching documentation', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Searching documentation', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Documentation search complete', icon: BookOpen },
      [ClientToolCallState.error]: { text: 'Failed to search docs', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted documentation search', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped documentation search', icon: MinusCircle },
    },
  }

  async execute(args?: SearchDocumentationArgs): Promise<void> {
    const logger = createLogger('SearchDocumentationClientTool')
    try {
      this.setState(ClientToolCallState.executing)
      const res = await fetch('/api/copilot/execute-copilot-server-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: 'search_documentation', payload: args || {} }),
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        throw new Error(txt || `Server error (${res.status})`)
      }
      const json = await res.json()
      const parsed = ExecuteResponseSuccessSchema.parse(json)
      this.setState(ClientToolCallState.success)
      await this.markToolComplete(200, 'Documentation search complete', parsed.result)
      this.setState(ClientToolCallState.success)
    } catch (e: any) {
      logger.error('execute failed', { message: e?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, e?.message || 'Documentation search failed')
    }
  }
}
