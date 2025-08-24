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
import { createLogger } from '@/lib/logs/console/logger'

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
      [ClientToolCallState.generating]: { text: 'Evaluating block choices', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Evaluating block choices', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Evaluating block choices', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Evaluated block choices', icon: ListFilter },
      [ClientToolCallState.error]: { text: 'Failed to evaluate block choices', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted evaluating block choices', icon: XCircle },
      [ClientToolCallState.rejected]: {
        text: 'Skipped evaluating block choices',
        icon: MinusCircle,
      },
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
      await this.markToolComplete(500, message)
      this.setState(ClientToolCallState.error)
    }
  }
}
