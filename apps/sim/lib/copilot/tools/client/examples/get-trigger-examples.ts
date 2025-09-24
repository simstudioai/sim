import { Loader2, MinusCircle, XCircle, Zap } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class GetTriggerExamplesClientTool extends BaseClientTool {
  static readonly id = 'get_trigger_examples'

  constructor(toolCallId: string) {
    super(toolCallId, GetTriggerExamplesClientTool.id, GetTriggerExamplesClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Selecting a trigger', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Selecting a trigger', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Selecting a trigger', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Selected a trigger', icon: Zap },
      [ClientToolCallState.error]: { text: 'Failed to select a trigger', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted selecting a trigger', icon: MinusCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped selecting a trigger', icon: MinusCircle },
    },
    interrupt: undefined,
  }

  async execute(): Promise<void> {
    return
  }
}
