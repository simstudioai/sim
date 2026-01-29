import { Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class MarkTodoInProgressClientTool extends BaseClientTool {
  static readonly id = 'mark_todo_in_progress'

  constructor(toolCallId: string) {
    super(toolCallId, MarkTodoInProgressClientTool.id, MarkTodoInProgressClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Marking todo in progress', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Marking todo in progress', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Marking todo in progress', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Marked todo in progress', icon: Loader2 },
      [ClientToolCallState.error]: { text: 'Failed to mark in progress', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted marking in progress', icon: MinusCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped marking in progress', icon: MinusCircle },
    },
  }

  // Executed server-side via handleToolCallEvent in stream-handler.ts
  // Client tool provides UI metadata only
}
