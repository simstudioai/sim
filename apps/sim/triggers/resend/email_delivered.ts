import { ResendIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildEmailDeliveredOutputs,
  buildResendExtraFields,
  resendSetupInstructions,
  resendTriggerOptions,
} from '@/triggers/resend/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Resend Email Delivered Trigger
 * Triggers when an email is successfully delivered to the recipient's mail server.
 */
export const resendEmailDeliveredTrigger: TriggerConfig = {
  id: 'resend_email_delivered',
  name: 'Resend Email Delivered',
  provider: 'resend',
  description: 'Trigger workflow when an email is delivered',
  version: '1.0.0',
  icon: ResendIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'resend_email_delivered',
    triggerOptions: resendTriggerOptions,
    setupInstructions: resendSetupInstructions('email.delivered'),
    extraFields: buildResendExtraFields('resend_email_delivered'),
  }),

  outputs: buildEmailDeliveredOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
