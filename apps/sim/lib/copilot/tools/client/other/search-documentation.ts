import { createLogger } from '@sim/logger'
import { BookOpen, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { ExecuteResponseSuccessSchema } from '@/lib/copilot/tools/shared/schemas'

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
      [ClientToolCallState.success]: { text: 'Completed documentation search', icon: BookOpen },
      [ClientToolCallState.error]: { text: 'Failed to search docs', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted documentation search', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped documentation search', icon: MinusCircle },
    },
    getDynamicText: (params, state) => {
      if (params?.query && typeof params.query === 'string') {
        const query = params.query

        switch (state) {
          case ClientToolCallState.success:
            return `Searched docs for ${query}`
          case ClientToolCallState.executing:
          case ClientToolCallState.generating:
          case ClientToolCallState.pending:
            return `Searching docs for ${query}`
          case ClientToolCallState.error:
            return `Failed to search docs for ${query}`
          case ClientToolCallState.aborted:
            return `Aborted searching docs for ${query}`
          case ClientToolCallState.rejected:
            return `Skipped searching docs for ${query}`
        }
      }
      return undefined
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
