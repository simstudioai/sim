import { AttioIcon } from '@/components/icons'
import { buildAttioTriggerSubBlocks, buildGenericWebhookOutputs } from '@/triggers/attio/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Generic Attio Webhook Trigger
 *
 * Captures all Attio webhook events without filtering.
 */
export const attioWebhookTrigger: TriggerConfig = {
  id: 'attio_webhook',
  name: 'Attio Webhook (All Events)',
  provider: 'attio',
  description: 'Trigger workflow on any Attio webhook event',
  version: '1.0.0',
  icon: AttioIcon,

  subBlocks: buildAttioTriggerSubBlocks('attio_webhook'),

  outputs: buildGenericWebhookOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Attio-Signature': 'hmac-sha256-signature',
    },
  },
}
