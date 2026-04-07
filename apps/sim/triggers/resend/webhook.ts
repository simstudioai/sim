import { ResendIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildResendExtraFields,
  buildResendOutputs,
  resendSetupInstructions,
  resendTriggerOptions,
} from '@/triggers/resend/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Generic Resend Webhook Trigger
 * Captures all Resend webhook events
 */
export const resendWebhookTrigger: TriggerConfig = {
  id: 'resend_webhook',
  name: 'Resend Webhook (All Events)',
  provider: 'resend',
  description:
    'Trigger on Resend webhook events we subscribe to (email lifecycle, contacts, domains—see Resend docs). Flattened email fields may be null for non-email events; use <code>data</code> for the full payload.',
  version: '1.0.0',
  icon: ResendIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'resend_webhook',
    triggerOptions: resendTriggerOptions,
    setupInstructions: resendSetupInstructions('All Events'),
    extraFields: buildResendExtraFields('resend_webhook'),
  }),

  outputs: buildResendOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
