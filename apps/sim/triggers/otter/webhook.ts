import { OtterIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildOtterOutputs,
  otterSetupInstructions,
  otterTriggerOptions,
} from '@/triggers/otter/utils'
import type { TriggerConfig } from '@/triggers/types'

export const otterWebhookTrigger: TriggerConfig = {
  id: 'otter_webhook',
  name: 'Otter Webhook',
  provider: 'otter',
  description: 'Trigger workflow on any Otter workspace webhook event',
  version: '1.0.0',
  icon: OtterIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'otter_webhook',
    triggerOptions: otterTriggerOptions,
    setupInstructions: otterSetupInstructions(['conversation.completed', 'conversation.shared']),
  }),

  outputs: buildOtterOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
