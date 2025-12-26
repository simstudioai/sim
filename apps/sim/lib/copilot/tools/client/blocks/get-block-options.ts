import { createLogger } from '@sim/logger'
import { ListFilter, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import {
  ExecuteResponseSuccessSchema,
  GetBlockOptionsInput,
  GetBlockOptionsResult,
} from '@/lib/copilot/tools/shared/schemas'

interface GetBlockOptionsArgs {
  blockId: string
}

export class GetBlockOptionsClientTool extends BaseClientTool {
  static readonly id = 'get_block_options'

  constructor(toolCallId: string) {
    super(toolCallId, GetBlockOptionsClientTool.id, GetBlockOptionsClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Getting block options', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Getting block options', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Getting block options', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Got block options', icon: ListFilter },
      [ClientToolCallState.error]: { text: 'Failed to get block options', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted getting block options', icon: XCircle },
      [ClientToolCallState.rejected]: {
        text: 'Skipped getting block options',
        icon: MinusCircle,
      },
    },
    getDynamicText: (params, state) => {
      if (params?.blockId && typeof params.blockId === 'string') {
        const blockName = params.blockId.replace(/_/g, ' ')

        switch (state) {
          case ClientToolCallState.success:
            return `Got ${blockName} options`
          case ClientToolCallState.executing:
          case ClientToolCallState.generating:
          case ClientToolCallState.pending:
            return `Getting ${blockName} options`
          case ClientToolCallState.error:
            return `Failed to get ${blockName} options`
          case ClientToolCallState.aborted:
            return `Aborted getting ${blockName} options`
          case ClientToolCallState.rejected:
            return `Skipped getting ${blockName} options`
        }
      }
      return undefined
    },
  }

  async execute(args?: GetBlockOptionsArgs): Promise<void> {
    const logger = createLogger('GetBlockOptionsClientTool')
    try {
      this.setState(ClientToolCallState.executing)

      const { blockId } = GetBlockOptionsInput.parse(args || {})

      const res = await fetch('/api/copilot/execute-copilot-server-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: 'get_block_options', payload: { blockId } }),
      })
      if (!res.ok) {
        const errorText = await res.text().catch(() => '')
        throw new Error(errorText || `Server error (${res.status})`)
      }
      const json = await res.json()
      const parsed = ExecuteResponseSuccessSchema.parse(json)
      const result = GetBlockOptionsResult.parse(parsed.result)

      await this.markToolComplete(200, { operations: result.operations.length }, result)
      this.setState(ClientToolCallState.success)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Execute failed', { message })
      await this.markToolComplete(500, message)
      this.setState(ClientToolCallState.error)
    }
  }
}
