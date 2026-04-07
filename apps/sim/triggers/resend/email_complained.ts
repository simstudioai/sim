import { ResendIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildEmailComplainedOutputs,
  buildResendExtraFields,
  resendSetupInstructions,
  resendTriggerOptions,
} from '@/triggers/resend/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Resend Email Complained Trigger
 * Triggers when a recipient marks an email as spam.
 */
export const resendEmailComplainedTrigger: TriggerConfig = {
  id: 'resend_email_complained',
  name: 'Resend Email Complained',
  provider: 'resend',
  description: 'Trigger workflow when an email is marked as spam',
  version: '1.0.0',
  icon: ResendIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'resend_email_complained',
    triggerOptions: resendTriggerOptions,
    setupInstructions: resendSetupInstructions('email.complained'),
    extraFields: buildResendExtraFields('resend_email_complained'),
  }),

  outputs: buildEmailComplainedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
