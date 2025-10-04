import { Loader2, MinusCircle, XCircle, Zap } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class GetOperationsExamplesClientTool extends BaseClientTool {
  static readonly id = 'get_operations_examples'

  constructor(toolCallId: string) {
    super(toolCallId, GetOperationsExamplesClientTool.id, GetOperationsExamplesClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Selecting an operation', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Selecting an operation', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Selecting an operation', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Selected an operation', icon: Zap },
      [ClientToolCallState.error]: { text: 'Failed to select an operation', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted selecting an operation', icon: MinusCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped selecting an operation', icon: MinusCircle },
    },
    interrupt: undefined,
  }

  async execute(): Promise<void> {
    return
  }
}
