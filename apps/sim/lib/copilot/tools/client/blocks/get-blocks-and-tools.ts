import { Blocks, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class GetBlocksAndToolsClientTool extends BaseClientTool {
  static readonly id = 'get_blocks_and_tools'

  constructor(toolCallId: string) {
    super(toolCallId, GetBlocksAndToolsClientTool.id, GetBlocksAndToolsClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Exploring available options', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Exploring available options', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Exploring available options', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Explored available options', icon: Blocks },
      [ClientToolCallState.error]: { text: 'Failed to explore options', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted exploring options', icon: MinusCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped exploring options', icon: MinusCircle },
    },
    interrupt: undefined,
  }

  async execute(): Promise<void> {
    // Tool execution is handled server-side by the orchestrator.
    // Client tool classes are retained for UI display configuration only.
    this.setState(ClientToolCallState.success)
  }
}
