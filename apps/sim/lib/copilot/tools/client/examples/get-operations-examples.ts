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
      [ClientToolCallState.generating]: { text: 'Designing workflow component', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Designing workflow component', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Designing workflow component', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Designed workflow component', icon: Zap },
      [ClientToolCallState.error]: { text: 'Failed to design workflow component', icon: XCircle },
      [ClientToolCallState.aborted]: {
        text: 'Aborted designing workflow component',
        icon: MinusCircle,
      },
      [ClientToolCallState.rejected]: {
        text: 'Skipped designing workflow component',
        icon: MinusCircle,
      },
    },
    interrupt: undefined,
    getDynamicText: (params, state) => {
      if (params?.query && typeof params.query === 'string') {
        const query = params.query

        switch (state) {
          case ClientToolCallState.success:
            return `Designed ${query}`
          case ClientToolCallState.executing:
          case ClientToolCallState.generating:
          case ClientToolCallState.pending:
            return `Designing ${query}`
          case ClientToolCallState.error:
            return `Failed to design ${query}`
          case ClientToolCallState.aborted:
            return `Aborted designing ${query}`
          case ClientToolCallState.rejected:
            return `Skipped designing ${query}`
        }
      }
      return undefined
    },
  }

  async execute(): Promise<void> {
    return
  }
}
