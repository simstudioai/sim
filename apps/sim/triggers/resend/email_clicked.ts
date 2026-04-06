import { ResendIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildEmailClickedOutputs,
  buildResendExtraFields,
  resendSetupInstructions,
  resendTriggerOptions,
} from '@/triggers/resend/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Resend Email Clicked Trigger
 * Triggers when a recipient clicks a link in an email.
 */
export const resendEmailClickedTrigger: TriggerConfig = {
  id: 'resend_email_clicked',
  name: 'Resend Email Clicked',
  provider: 'resend',
  description: 'Trigger workflow when a link in an email is clicked',
  version: '1.0.0',
  icon: ResendIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'resend_email_clicked',
    triggerOptions: resendTriggerOptions,
    setupInstructions: resendSetupInstructions('email.clicked'),
    extraFields: buildResendExtraFields('resend_email_clicked'),
  }),

  outputs: buildEmailClickedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
