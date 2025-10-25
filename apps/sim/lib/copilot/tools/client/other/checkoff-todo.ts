import { Check, Loader2, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { createLogger } from '@/lib/logs/console/logger'

interface CheckoffTodoArgs {
  id?: string
  todoId?: string
}

export class CheckoffTodoClientTool extends BaseClientTool {
  static readonly id = 'checkoff_todo'

  constructor(toolCallId: string) {
    super(toolCallId, CheckoffTodoClientTool.id, CheckoffTodoClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Marking todo', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Marking todo', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Todo marked complete', icon: Check },
      [ClientToolCallState.error]: { text: 'Failed to mark todo', icon: XCircle },
    },
  }

  async execute(args?: CheckoffTodoArgs): Promise<void> {
    const logger = createLogger('CheckoffTodoClientTool')
    try {
      this.setState(ClientToolCallState.executing)

      const todoId = args?.id || args?.todoId
      if (!todoId) {
        this.setState(ClientToolCallState.error)
        await this.markToolComplete(400, 'Missing todo id')
        return
      }

      try {
        const { useCopilotStore } = await import('@/stores/panel-new/copilot/store')
        const store = useCopilotStore.getState()
        if (store.updatePlanTodoStatus) {
          store.updatePlanTodoStatus(todoId, 'completed')
        }
      } catch (e) {
        logger.warn('Failed to update todo status in store', { message: (e as any)?.message })
      }

      this.setState(ClientToolCallState.success)
      await this.markToolComplete(200, 'Todo checked off', { todoId })
      this.setState(ClientToolCallState.success)
    } catch (e: any) {
      logger.error('execute failed', { message: e?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, e?.message || 'Failed to check off todo')
    }
  }
}
