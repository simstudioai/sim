import { ResendIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildEmailFailedOutputs,
  buildResendExtraFields,
  resendSetupInstructions,
  resendTriggerOptions,
} from '@/triggers/resend/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Resend Email Failed Trigger
 * Triggers when an email fails to send.
 */
export const resendEmailFailedTrigger: TriggerConfig = {
  id: 'resend_email_failed',
  name: 'Resend Email Failed',
  provider: 'resend',
  description: 'Trigger workflow when an email fails to send',
  version: '1.0.0',
  icon: ResendIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'resend_email_failed',
    triggerOptions: resendTriggerOptions,
    setupInstructions: resendSetupInstructions('email.failed'),
    extraFields: buildResendExtraFields('resend_email_failed'),
  }),

  outputs: buildEmailFailedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
