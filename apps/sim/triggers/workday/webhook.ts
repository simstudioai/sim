import { WorkdayIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'
import { buildGenericWebhookOutputs, buildWorkdaySubBlocks } from '@/triggers/workday/utils'

export const workdayWebhookTrigger: TriggerConfig = {
  id: 'workday_webhook',
  name: 'Workday Webhook',
  provider: 'workday',
  description: 'Receive any Workday SOAP notification event',
  version: '1.0.0',
  icon: WorkdayIcon,

  subBlocks: buildWorkdaySubBlocks({
    triggerId: 'workday_webhook',
    eventType: 'Any Business Process',
  }),

  outputs: buildGenericWebhookOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml',
    },
  },
}
