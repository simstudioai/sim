import { createLogger } from '@sim/logger'
import { FileCode, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import {
  ExecuteResponseSuccessSchema,
  GetBlockConfigInput,
  GetBlockConfigResult,
} from '@/lib/copilot/tools/shared/schemas'
import { getLatestBlock } from '@/blocks/registry'

interface GetBlockConfigArgs {
  blockType: string
  operation?: string
  trigger?: boolean
}

export class GetBlockConfigClientTool extends BaseClientTool {
  static readonly id = 'get_block_config'

  constructor(toolCallId: string) {
    super(toolCallId, GetBlockConfigClientTool.id, GetBlockConfigClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Getting block config', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Getting block config', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Getting block config', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Retrieved block config', icon: FileCode },
      [ClientToolCallState.error]: { text: 'Failed to get block config', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted getting block config', icon: XCircle },
      [ClientToolCallState.rejected]: {
        text: 'Skipped getting block config',
        icon: MinusCircle,
      },
    },
    getDynamicText: (params, state) => {
      if (params?.blockType && typeof params.blockType === 'string') {
        const blockConfig = getLatestBlock(params.blockType)
        const blockName = (blockConfig?.name ?? params.blockType.replace(/_/g, ' ')).toLowerCase()
        const opSuffix = params.operation ? ` (${params.operation})` : ''

        switch (state) {
          case ClientToolCallState.success:
            return `Retrieved ${blockName}${opSuffix} config`
          case ClientToolCallState.executing:
          case ClientToolCallState.generating:
          case ClientToolCallState.pending:
            return `Retrieving ${blockName}${opSuffix} config`
          case ClientToolCallState.error:
            return `Failed to retrieve ${blockName}${opSuffix} config`
          case ClientToolCallState.aborted:
            return `Aborted retrieving ${blockName}${opSuffix} config`
          case ClientToolCallState.rejected:
            return `Skipped retrieving ${blockName}${opSuffix} config`
        }
      }
      return undefined
    },
  }

  async execute(args?: GetBlockConfigArgs): Promise<void> {
    const logger = createLogger('GetBlockConfigClientTool')
    try {
      this.setState(ClientToolCallState.executing)

      const { blockType, operation, trigger } = GetBlockConfigInput.parse(args || {})

      const res = await fetch('/api/copilot/execute-copilot-server-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName: 'get_block_config',
          payload: { blockType, operation, trigger },
        }),
      })
      if (!res.ok) {
        const errorText = await res.text().catch(() => '')
        throw new Error(errorText || `Server error (${res.status})`)
      }
      const json = await res.json()
      const parsed = ExecuteResponseSuccessSchema.parse(json)
      const result = GetBlockConfigResult.parse(parsed.result)

      const inputCount = Object.keys(result.inputs).length
      const outputCount = Object.keys(result.outputs).length
      await this.markToolComplete(200, { inputs: inputCount, outputs: outputCount }, result)
      this.setState(ClientToolCallState.success)
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Execute failed', { message })
      await this.markToolComplete(500, message)
      this.setState(ClientToolCallState.error)
    }
  }
}
