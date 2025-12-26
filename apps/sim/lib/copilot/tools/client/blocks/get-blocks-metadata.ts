import { createLogger } from '@sim/logger'
import { ListFilter, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import {
  ExecuteResponseSuccessSchema,
  GetBlocksMetadataInput,
  GetBlocksMetadataResult,
} from '@/lib/copilot/tools/shared/schemas'

interface GetBlocksMetadataArgs {
  blockIds: string[]
}

export class GetBlocksMetadataClientTool extends BaseClientTool {
  static readonly id = 'get_blocks_metadata'

  constructor(toolCallId: string) {
    super(toolCallId, GetBlocksMetadataClientTool.id, GetBlocksMetadataClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Searching block choices', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Searching block choices', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Searching block choices', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Searched block choices', icon: ListFilter },
      [ClientToolCallState.error]: { text: 'Failed to search block choices', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted searching block choices', icon: XCircle },
      [ClientToolCallState.rejected]: {
        text: 'Skipped searching block choices',
        icon: MinusCircle,
      },
    },
    getDynamicText: (params, state) => {
      if (params?.blockIds && Array.isArray(params.blockIds) && params.blockIds.length > 0) {
        const blockList = params.blockIds
          .slice(0, 3)
          .map((blockId) => blockId.replace(/_/g, ' '))
          .join(', ')
        const more = params.blockIds.length > 3 ? '...' : ''
        const blocks = `${blockList}${more}`

        switch (state) {
          case ClientToolCallState.success:
            return `Searched ${blocks}`
          case ClientToolCallState.executing:
          case ClientToolCallState.generating:
          case ClientToolCallState.pending:
            return `Searching ${blocks}`
          case ClientToolCallState.error:
            return `Failed to search ${blocks}`
          case ClientToolCallState.aborted:
            return `Aborted searching ${blocks}`
          case ClientToolCallState.rejected:
            return `Skipped searching ${blocks}`
        }
      }
      return undefined
    },
  }

  async execute(args?: GetBlocksMetadataArgs): Promise<void> {
    const logger = createLogger('GetBlocksMetadataClientTool')
    try {
      this.setState(ClientToolCallState.executing)

      const { blockIds } = GetBlocksMetadataInput.parse(args || {})

      const res = await fetch('/api/copilot/execute-copilot-server-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: 'get_blocks_metadata', payload: { blockIds } }),
      })
      if (!res.ok) {
        const errorText = await res.text().catch(() => '')
        throw new Error(errorText || `Server error (${res.status})`)
      }
      const json = await res.json()
      const parsed = ExecuteResponseSuccessSchema.parse(json)
      const result = GetBlocksMetadataResult.parse(parsed.result)

      await this.markToolComplete(200, { retrieved: Object.keys(result.metadata).length }, result)
      this.setState(ClientToolCallState.success)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Execute failed', { message })
      await this.markToolComplete(500, message)
      this.setState(ClientToolCallState.error)
    }
  }
}
