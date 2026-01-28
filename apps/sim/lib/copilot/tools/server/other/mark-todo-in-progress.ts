import { createLogger } from '@sim/logger'
import { z } from 'zod'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'

const logger = createLogger('MarkTodoInProgressServerTool')

export const MarkTodoInProgressInput = z.object({
  id: z.string().optional(),
  todoId: z.string().optional(),
})

export const MarkTodoInProgressResult = z.object({
  todoId: z.string(),
  success: z.boolean(),
})

export type MarkTodoInProgressInputType = z.infer<typeof MarkTodoInProgressInput>
export type MarkTodoInProgressResultType = z.infer<typeof MarkTodoInProgressResult>

/**
 * Server-side tool to mark a todo as in progress.
 * The actual UI update happens client-side when the store receives the tool_result event.
 */
export const markTodoInProgressServerTool: BaseServerTool<
  MarkTodoInProgressInputType,
  MarkTodoInProgressResultType
> = {
  name: 'mark_todo_in_progress',
  async execute(args: unknown, _context?: { userId: string }) {
    const parsed = MarkTodoInProgressInput.parse(args)
    const todoId = parsed.id || parsed.todoId

    if (!todoId) {
      throw new Error('Missing todo id')
    }

    logger.info('Marking todo as in progress', { todoId })

    // The actual state update happens client-side via tool_result handler
    return MarkTodoInProgressResult.parse({
      todoId,
      success: true,
    })
  },
}
