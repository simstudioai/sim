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
        const truncated = query.length > 40 ? `${query.slice(0, 40)}...` : query

        switch (state) {
          case ClientToolCallState.success:
            return `Designed ${truncated}`
          case ClientToolCallState.executing:
          case ClientToolCallState.generating:
          case ClientToolCallState.pending:
            return `Designing ${truncated}`
          case ClientToolCallState.error:
            return `Failed to design ${truncated}`
          case ClientToolCallState.aborted:
            return `Aborted designing ${truncated}`
          case ClientToolCallState.rejected:
            return `Skipped designing ${truncated}`
        }
      }
      return undefined
    },
  }

  async execute(): Promise<void> {
    return
  }
}
