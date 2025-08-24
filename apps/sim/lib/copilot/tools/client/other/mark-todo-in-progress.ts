import { Loader2, MinusCircle, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { createLogger } from '@/lib/logs/console/logger'

interface MarkTodoInProgressArgs {
  id?: string
  todoId?: string
}

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
      [ClientToolCallState.success]: { text: 'Todo marked in progress', icon: Loader2 },
      [ClientToolCallState.error]: { text: 'Failed to mark in progress', icon: XCircle },
      [ClientToolCallState.aborted]: { text: 'Aborted marking in progress', icon: MinusCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped marking in progress', icon: MinusCircle },
    },
  }

  async execute(args?: MarkTodoInProgressArgs): Promise<void> {
    const logger = createLogger('MarkTodoInProgressClientTool')
    try {
      this.setState(ClientToolCallState.executing)

      const todoId = args?.id || args?.todoId
      if (!todoId) {
        this.setState(ClientToolCallState.error)
        await this.markToolComplete(400, 'Missing todo id')
        return
      }

      try {
        const { useCopilotStore } = await import('@/stores/copilot/store')
        const store = useCopilotStore.getState()
        if (store.updatePlanTodoStatus) {
          store.updatePlanTodoStatus(todoId, 'executing')
        }
      } catch (e) {
        logger.warn('Failed to update todo status in store', { message: (e as any)?.message })
      }

      this.setState(ClientToolCallState.success)
      await this.markToolComplete(200, 'Todo marked in progress', { todoId })
      this.setState(ClientToolCallState.success)
    } catch (e: any) {
      logger.error('execute failed', { message: e?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, e?.message || 'Failed to mark todo in progress')
    }
  }
}
