import { ResendIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildEmailSentOutputs,
  buildResendExtraFields,
  resendSetupInstructions,
  resendTriggerOptions,
} from '@/triggers/resend/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Resend Email Sent Trigger
 * Triggers when an email is sent by Resend.
 *
 * This is the PRIMARY trigger - it includes the dropdown for selecting trigger type.
 */
export const resendEmailSentTrigger: TriggerConfig = {
  id: 'resend_email_sent',
  name: 'Resend Email Sent',
  provider: 'resend',
  description: 'Trigger workflow when an email is sent',
  version: '1.0.0',
  icon: ResendIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'resend_email_sent',
    triggerOptions: resendTriggerOptions,
    includeDropdown: true,
    setupInstructions: resendSetupInstructions('email.sent'),
    extraFields: buildResendExtraFields('resend_email_sent'),
  }),

  outputs: buildEmailSentOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
