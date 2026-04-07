import { ResendIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildEmailOpenedOutputs,
  buildResendExtraFields,
  resendSetupInstructions,
  resendTriggerOptions,
} from '@/triggers/resend/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Resend Email Opened Trigger
 * Triggers when a recipient opens an email.
 */
export const resendEmailOpenedTrigger: TriggerConfig = {
  id: 'resend_email_opened',
  name: 'Resend Email Opened',
  provider: 'resend',
  description: 'Trigger workflow when an email is opened',
  version: '1.0.0',
  icon: ResendIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'resend_email_opened',
    triggerOptions: resendTriggerOptions,
    setupInstructions: resendSetupInstructions('email.opened'),
    extraFields: buildResendExtraFields('resend_email_opened'),
  }),

  outputs: buildEmailOpenedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
