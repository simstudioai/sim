import { EmailBisonIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildEmailBisonEmailAccountRemovedOutputs,
  buildEmailBisonExtraFields,
  emailBisonSetupInstructions,
  emailBisonTriggerOptions,
} from '@/triggers/emailbison/utils'
import type { TriggerConfig } from '@/triggers/types'

export const emailBisonEmailAccountRemovedTrigger: TriggerConfig = {
  id: 'emailbison_email_account_removed',
  name: 'Email Bison Email Account Removed',
  provider: 'emailbison',
  description: 'Trigger when a sender email account is removed from Email Bison',
  version: '1.0.0',
  icon: EmailBisonIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'emailbison_email_account_removed',
    triggerOptions: emailBisonTriggerOptions,
    setupInstructions: emailBisonSetupInstructions('Email Account Removed'),
    extraFields: buildEmailBisonExtraFields('emailbison_email_account_removed'),
  }),
  outputs: buildEmailBisonEmailAccountRemovedOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
