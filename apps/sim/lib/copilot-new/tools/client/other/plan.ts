import { Loader2, ListTodo, XCircle } from 'lucide-react'
import { BaseClientTool, ClientToolCallState, type BaseClientToolMetadata } from '@/lib/copilot-new/tools/client/base-tool'
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
      [ClientToolCallState.generating]: { text: 'DESIGNINGGGG an approach', icon: Loader2 },
      [ClientToolCallState.executing]: { text: 'DESIGNINGGGGGG an approach', icon: Loader2 },
      [ClientToolCallState.success]: { text: 'Designed an approach', icon: ListTodo },
      [ClientToolCallState.error]: { text: 'Errored planning approach', icon: XCircle },
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
          const { useCopilotStore } = await import('@/stores/copilot/store')
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