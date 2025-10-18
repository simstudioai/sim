import { Loader2, MinusCircle, PencilLine, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class SummarizeClientTool extends BaseClientTool {
  static readonly id = 'summarize_conversation'

  constructor(toolCallId: string) {
    super(toolCallId, SummarizeClientTool.id, SummarizeClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Summarizing conversation', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Summarizing conversation', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Summarizing conversation', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Summarized conversation', icon: PencilLine },
      [ClientToolCallState.error]: { text: 'Failed to summarize conversation', icon: XCircle },
      [ClientToolCallState.aborted]: {
        text: 'Aborted summarizing conversation',
        icon: MinusCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped summarizing conversation',
        icon: MinusCircle,
      },
    },
    interrupt: undefined,
  }

  async execute(): Promise<void> {
    return
  }
}
