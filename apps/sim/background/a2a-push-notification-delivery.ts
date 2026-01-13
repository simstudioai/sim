import type { TaskState } from '@a2a-js/sdk'
import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import { deliverPushNotification } from '@/lib/a2a/push-notifications'

const logger = createLogger('A2APushNotificationDelivery')

export interface A2APushNotificationParams {
  taskId: string
  state: TaskState
}

export const a2aPushNotificationTask = task({
  id: 'a2a-push-notification-delivery',
  retry: {
    maxAttempts: 5,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 60000,
    factor: 2,
  },
  run: async (params: A2APushNotificationParams) => {
    logger.info('Delivering A2A push notification', params)

    const success = await deliverPushNotification(params.taskId, params.state)

    if (!success) {
      throw new Error(`Failed to deliver push notification for task ${params.taskId}`)
    }

    logger.info('A2A push notification delivered successfully', params)
    return { success: true, taskId: params.taskId, state: params.state }
  },
})
