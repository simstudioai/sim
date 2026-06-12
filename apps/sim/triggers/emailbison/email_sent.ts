import { EmailBisonIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildEmailBisonEmailSentOutputs,
  buildEmailBisonExtraFields,
  emailBisonSetupInstructions,
  emailBisonTriggerOptions,
} from '@/triggers/emailbison/utils'
import type { TriggerConfig } from '@/triggers/types'

export const emailBisonEmailSentTrigger: TriggerConfig = {
  id: 'emailbison_email_sent',
  name: 'Email Bison Email Sent',
  provider: 'emailbison',
  description: 'Trigger when a campaign email is sent in Email Bison',
  version: '1.0.0',
  icon: EmailBisonIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'emailbison_email_sent',
    triggerOptions: emailBisonTriggerOptions,
    includeDropdown: true,
    setupInstructions: emailBisonSetupInstructions('Email Sent'),
    extraFields: buildEmailBisonExtraFields('emailbison_email_sent'),
  }),
  outputs: buildEmailBisonEmailSentOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
