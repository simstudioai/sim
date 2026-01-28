import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import {
  type ListUserWorkflowsInputType,
  ListUserWorkflowsResult,
  type ListUserWorkflowsResultType,
} from '@/lib/copilot/tools/shared/schemas'

const logger = createLogger('ListUserWorkflowsServerTool')

export const listUserWorkflowsServerTool: BaseServerTool<
  ListUserWorkflowsInputType,
  ListUserWorkflowsResultType
> = {
  name: 'list_user_workflows',
  async execute(_args: unknown, context?: { userId: string }) {
    logger.debug('Executing list_user_workflows', { userId: context?.userId })

    if (!context?.userId) {
      throw new Error('User ID is required to list workflows')
    }

    const workflows = await db
      .select({ id: workflow.id, name: workflow.name })
      .from(workflow)
      .where(eq(workflow.userId, context.userId))

    const names = workflows
      .map((w) => w.name)
      .filter((n): n is string => typeof n === 'string' && n.length > 0)

    logger.info('Found workflows', { count: names.length, userId: context.userId })

    return ListUserWorkflowsResult.parse({
      workflow_names: names,
      count: names.length,
    })
  },
}
