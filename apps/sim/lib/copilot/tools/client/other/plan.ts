import { ListTodo, Loader2, X, XCircle } from 'lucide-react'
import {
  BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
} from '@/lib/copilot/tools/client/base-tool'
import { createLogger } from '@/lib/logs/console/logger'

interface PlanArgs {
  objective?: string
  todoList?: Array<{ id?: string; content: string } | string>
}

export class PlanClientTool extends BaseClientTool {
  static readonly id = 'plan'

  constructor(toolCallId: string) {
    super(toolCallId, PlanClientTool.id, PlanClientTool.metadata)
  }

  static readonly metadata: BaseClientToolMetadata = {
    displayNames: {
      [ClientToolCallState.generating]: { text: 'Planning', icon: Loader2 },
      [ClientToolCallState.pending]: { text: 'Planning', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'Planning an approach', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Finished planning', icon: ListTodo },
      [ClientToolCallState.error]: { text: 'Failed to plan', icon: X },
      [ClientToolCallState.aborted]: { text: 'Aborted planning', icon: XCircle },
      [ClientToolCallState.rejected]: { text: 'Skipped planning approach', icon: XCircle },
    },
  }

  async execute(args?: PlanArgs): Promise<void> {
    const logger = createLogger('PlanClientTool')
    try {
      this.setState(ClientToolCallState.executing)

      // Update store todos from args if present (client-side only)
      try {
        const todoList = args?.todoList
        if (Array.isArray(todoList)) {
          const todos = todoList.map((item: any, index: number) => ({
            id: (item && (item.id || item.todoId)) || `todo-${index}`,
            content: typeof item === 'string' ? item : item.content,
            completed: false,
            executing: false,
          }))
          const { useCopilotStore } = await import('@/stores/panel-new/copilot/store')
          const store = useCopilotStore.getState()
          if (store.setPlanTodos) {
            store.setPlanTodos(todos)
            useCopilotStore.setState({ showPlanTodos: true })
          }
        }
      } catch (e) {
        logger.warn('Failed to update plan todos in store', { message: (e as any)?.message })
      }

      this.setState(ClientToolCallState.success)
      // Echo args back so store/tooling can parse todoList if needed
      await this.markToolComplete(200, 'Plan ready', args || {})
      this.setState(ClientToolCallState.success)
    } catch (e: any) {
      logger.error('execute failed', { message: e?.message })
      this.setState(ClientToolCallState.error)
      await this.markToolComplete(500, e?.message || 'Failed to plan')
    }
  }
}
