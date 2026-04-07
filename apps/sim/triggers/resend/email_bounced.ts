import { ResendIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildEmailBouncedOutputs,
  buildResendExtraFields,
  resendSetupInstructions,
  resendTriggerOptions,
} from '@/triggers/resend/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Resend Email Bounced Trigger
 * Triggers when an email permanently bounces.
 */
export const resendEmailBouncedTrigger: TriggerConfig = {
  id: 'resend_email_bounced',
  name: 'Resend Email Bounced',
  provider: 'resend',
  description: 'Trigger workflow when an email bounces',
  version: '1.0.0',
  icon: ResendIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'resend_email_bounced',
    triggerOptions: resendTriggerOptions,
    setupInstructions: resendSetupInstructions('email.bounced'),
    extraFields: buildResendExtraFields('resend_email_bounced'),
  }),

  outputs: buildEmailBouncedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
