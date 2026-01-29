import { Loader2, MinusCircle, TerminalSquare, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class GetWorkflowConsoleClientTool extends BaseClientTool {
  static readonly id = 'get_workflow_console'

  constructor(toolCallId: string) {
    super(toolCallId, GetWorkflowConsoleClientTool.id, GetWorkflowConsoleClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Fetching execution logs', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Fetching execution logs', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Fetched execution logs', icon: TerminalSquare },
      [ClientToolCallState.error]: { text: 'Failed to fetch execution logs', icon: XCircle },
      [ClientToolCallState.rejected]: {
        text: 'Skipped fetching execution logs',
        icon: MinusCircle,
      },
      [ClientToolCallState.aborted]: {
        text: 'Aborted fetching execution logs',
        icon: MinusCircle,
      },
      [ClientToolCallState.pending]: { text: 'Fetching execution logs', icon: Loader2 },
    },
    getDynamicText: (params, state) => {
      const limit = params?.limit
      if (limit && typeof limit === 'number') {
        const logText = limit === 1 ? 'execution log' : 'execution logs'

        switch (state) {
          case ClientToolCallState.success:
            return `Fetched last ${limit} ${logText}`
          case ClientToolCallState.executing:
          case ClientToolCallState.generating:
          case ClientToolCallState.pending:
            return `Fetching last ${limit} ${logText}`
          case ClientToolCallState.error:
            return `Failed to fetch last ${limit} ${logText}`
          case ClientToolCallState.rejected:
            return `Skipped fetching last ${limit} ${logText}`
          case ClientToolCallState.aborted:
            return `Aborted fetching last ${limit} ${logText}`
        }
      }
      return undefined
    },
  }

  // Executed server-side via handleToolCallEvent in stream-handler.ts
  // Client tool provides UI metadata only
}
