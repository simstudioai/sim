import { FileCode, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { getLatestBlock } from '@/blocks/registry'

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

  async execute(): Promise<void> {
    // Tool execution is handled server-side by the orchestrator.
    // Client tool classes are retained for UI display configuration only.
    this.setState(ClientToolCallState.success)
  }
}
