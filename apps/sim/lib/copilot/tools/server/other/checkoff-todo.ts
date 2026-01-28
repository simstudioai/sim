import { createLogger } from '@sim/logger'
import { z } from 'zod'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'

const logger = createLogger('CheckoffTodoServerTool')

export const CheckoffTodoInput = z.object({
  id: z.string().optional(),
  todoId: z.string().optional(),
})

export const CheckoffTodoResult = z.object({
  todoId: z.string(),
  success: z.boolean(),
})

export type CheckoffTodoInputType = z.infer<typeof CheckoffTodoInput>
export type CheckoffTodoResultType = z.infer<typeof CheckoffTodoResult>

/**
 * Server-side tool to mark a todo as complete.
 * The actual UI update happens client-side when the store receives the tool_result event.
 */
export const checkoffTodoServerTool: BaseServerTool<CheckoffTodoInputType, CheckoffTodoResultType> =
  {
    name: 'checkoff_todo',
    async execute(args: unknown, _context?: { userId: string }) {
      const parsed = CheckoffTodoInput.parse(args)
      const todoId = parsed.id || parsed.todoId

      if (!todoId) {
        throw new Error('Missing todo id')
      }

      logger.info('Marking todo as complete', { todoId })

      // The actual state update happens client-side via tool_result handler
      // We just return success to signal the action was processed
      return CheckoffTodoResult.parse({
        todoId,
        success: true,
      })
    },
  }
