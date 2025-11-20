import { CheckCircle2, Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'

export class RememberDebugClientTool extends BaseClientTool {
  static readonly id = 'remember_debug'

  constructor(toolCallId: string) {
    super(toolCallId, RememberDebugClientTool.id, RememberDebugClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Validating fix', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Validating fix', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Validating fix', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Validated fix', icon: CheckCircle2 },
      [ClientToolCallState.error]: { text: 'Failed to validate', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted validation', icon: MinusCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped validation', icon: MinusCircle },
    },
    interrupt: undefined,
    getDynamicText: (params, state) => {
      const operation = params?.operation

      if (operation === 'add' || operation === 'edit') {
        // For add/edit, show from problem or solution
        const text = params?.problem || params?.solution
        if (text && typeof text === 'string') {
          const truncated = text.length > 40 ? `${text.slice(0, 40)}...` : text

          switch (state) {
            case ClientToolCallState.success:
              return `Validated fix ${truncated}`
            case ClientToolCallState.executing:
            case ClientToolCallState.generating:
            case ClientToolCallState.pending:
              return `Validating fix ${truncated}`
            case ClientToolCallState.error:
              return `Failed to validate fix ${truncated}`
            case ClientToolCallState.aborted:
              return `Aborted validating fix ${truncated}`
            case ClientToolCallState.rejected:
              return `Skipped validating fix ${truncated}`
          }
        }
      } else if (operation === 'delete') {
        // For delete, show from problem or solution (or id as fallback)
        const text = params?.problem || params?.solution || params?.id
        if (text && typeof text === 'string') {
          const truncated = text.length > 40 ? `${text.slice(0, 40)}...` : text

          switch (state) {
            case ClientToolCallState.success:
              return `Adjusted fix ${truncated}`
            case ClientToolCallState.executing:
            case ClientToolCallState.generating:
            case ClientToolCallState.pending:
              return `Adjusting fix ${truncated}`
            case ClientToolCallState.error:
              return `Failed to adjust fix ${truncated}`
            case ClientToolCallState.aborted:
              return `Aborted adjusting fix ${truncated}`
            case ClientToolCallState.rejected:
              return `Skipped adjusting fix ${truncated}`
          }
        }
      }

      return undefined
    },
  }

  async execute(): Promise<void> {
    return
  }
}
