import { Globe2, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { ExecuteResponseSuccessSchema } from '@/lib/copilot/tools/shared/schemas'
import { createLogger } from '@/lib/logs/console/logger'

interface MakeApiRequestArgs {
  url: string
  method: 'GET' | 'POST' | 'PUT'
  queryParams?: Record<string, string | number | boolean>
  headers?: Record<string, string>
  body?: any
}

export class MakeApiRequestClientTool extends BaseClientTool {
  static readonly id = 'make_api_request'

  constructor(toolCallId: string) {
    super(toolCallId, MakeApiRequestClientTool.id, MakeApiRequestClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Preparing API request', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Review API request', icon: Globe2 },
      [ClientToolCallState.executing]: { text: 'Executing API request', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'API request complete', icon: Globe2 },
      [ClientToolCallState.error]: { text: 'Failed to execute API request', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped API request', icon: MinusCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted API request', icon: XCircle },
    },
    interrupt: {
      accept: { text: 'Execute', icon: Globe2 },
      reject: { text: 'Skip', icon: MinusCircle },
    },
    getDynamicText: (params, state) => {
      if (params?.url && typeof params.url === 'string') {
        const method = params.method || 'GET'
        let url = params.url

        // Extract domain from URL for cleaner display
        try {
          const urlObj = new URL(url)
          url = urlObj.hostname + urlObj.pathname
          if (url.length > 40) {
            url = `${url.slice(0, 40)}...`
          }
        } catch {
          // If URL parsing fails, just truncate
          if (url.length > 40) {
            url = `${url.slice(0, 40)}...`
          }
        }

        switch (state) {
          case ClientToolCallState.success:
            return `${method} ${url} complete`
          case ClientToolCallState.executing:
            return `${method} ${url}`
          case ClientToolCallState.generating:
            return `Preparing ${method} ${url}`
          case ClientToolCallState.pending:
            return `Review ${method} ${url}`
          case ClientToolCallState.error:
            return `Failed ${method} ${url}`
          case ClientToolCallState.rejected:
            return `Skipped ${method} ${url}`
          case ClientToolCallState.aborted:
            return `Aborted ${method} ${url}`
        }
      }
      return undefined
    },
  }

  async handleReject(): Promise<void> {
    await super.handleReject()
    this.setState(ClientToolCallState.rejected)
  }

  async handleAccept(args?: MakeApiRequestArgs): Promise<void> {
    const logger = createLogger('MakeApiRequestClientTool')
    try {
      this.setState(ClientToolCallState.executing)
      const res = await fetch('/api/copilot/execute-copilot-server-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: 'make_api_request', payload: args || {} }),
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        throw new Error(txt || `Server error (${res.status})`)
      }
      const json = await res.json()
      const parsed = ExecuteResponseSuccessSchema.parse(json)
      this.setState(ClientToolCallState.success)
      await this.markToolComplete(200, 'API request executed', parsed.result)
      this.setState(ClientToolCallState.success)
    } catch (e: any) {
      logger.error('execute failed', { message: e?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, e?.message || 'API request failed')
    }
  }

  async execute(args?: MakeApiRequestArgs): Promise<void> {
    await this.handleAccept(args)
  }
}
