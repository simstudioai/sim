import { createLogger } from '@sim/logger'
import { task } from '@trigger.dev/sdk'
import { pollProvider } from '@/lib/webhooks/polling'

const logger = createLogger('TriggerProviderPolling')

export type ProviderPollingPayload = {
  provider: string
  requestId: string
}

export const providerPolling = task({
  id: 'provider-polling',
  machine: 'medium-1x',
  maxDuration: 300,
  retry: {
    maxAttempts: 1,
  },
  queue: {
    name: 'provider-polling',
    concurrencyLimit: 1,
  },
  run: async (payload: ProviderPollingPayload) => {
    const { provider, requestId } = payload

    logger.info(`[${requestId}] Starting ${provider} polling`)

    const result = await pollProvider(provider)

    logger.info(`[${requestId}] ${provider} polling completed`, result)

    return result
  },
})
