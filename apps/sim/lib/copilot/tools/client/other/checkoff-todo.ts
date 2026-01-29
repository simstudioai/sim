import { Check, Loader2, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class CheckoffTodoClientTool extends BaseClientTool {
  static readonly id = 'checkoff_todo'

  constructor(toolCallId: string) {
    super(toolCallId, CheckoffTodoClientTool.id, CheckoffTodoClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Marking todo', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Marking todo', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Marked todo complete', icon: Check },
      [ClientToolCallState.error]: { text: 'Failed to mark todo', icon: XCircle },
    },
  }

  // Executed server-side via handleToolCallEvent in stream-handler.ts
  // Client tool provides UI metadata only
}
