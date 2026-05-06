import { EmailBisonIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildEmailBisonExtraFields,
  buildEmailBisonManualEmailSentOutputs,
  emailBisonSetupInstructions,
  emailBisonTriggerOptions,
} from '@/triggers/emailbison/utils'
import type { TriggerConfig } from '@/triggers/types'

export const emailBisonManualEmailSentTrigger: TriggerConfig = {
  id: 'emailbison_manual_email_sent',
  name: 'Email Bison Manual Email Sent',
  provider: 'emailbison',
  description: 'Trigger when a manual email is sent in Email Bison',
  version: '1.0.0',
  icon: EmailBisonIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'emailbison_manual_email_sent',
    triggerOptions: emailBisonTriggerOptions,
    setupInstructions: emailBisonSetupInstructions('Manual Email Sent'),
    extraFields: buildEmailBisonExtraFields('emailbison_manual_email_sent'),
  }),
  outputs: buildEmailBisonManualEmailSentOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
