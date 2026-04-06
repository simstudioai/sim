import { VercelIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import {
  buildVercelExtraFields,
  buildVercelOutputs,
  vercelSetupInstructions,
  vercelTriggerOptions,
} from '@/triggers/vercel/utils'

/**
 * Generic Vercel Webhook Trigger
 * Captures all Vercel webhook events
 */
export const vercelWebhookTrigger: TriggerConfig = {
  id: 'vercel_webhook',
  name: 'Vercel Webhook (All Events)',
  provider: 'vercel',
  description: 'Trigger workflow on any Vercel webhook event',
  version: '1.0.0',
  icon: VercelIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'vercel_webhook',
    triggerOptions: vercelTriggerOptions,
    setupInstructions: vercelSetupInstructions('All Events'),
    extraFields: buildVercelExtraFields('vercel_webhook'),
  }),

  outputs: buildVercelOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
