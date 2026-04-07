import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import { executeInboxTask } from '@/lib/mothership/inbox/executor'

const logger = createLogger('MothershipInboxExecution')

export interface MothershipInboxExecutionParams {
  taskId: string
}

export const mothershipInboxExecution = task({
  id: 'mothership-inbox-execution',
  machine: { preset: 'medium-1x' },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 30000,
    factor: 2,
  },
  run: async (params: MothershipInboxExecutionParams) => {
    logger.info('Starting inbox task execution', { taskId: params.taskId })

    await executeInboxTask(params.taskId)

    logger.info('Inbox task execution completed', { taskId: params.taskId })
    return { success: true, taskId: params.taskId }
  },
})
