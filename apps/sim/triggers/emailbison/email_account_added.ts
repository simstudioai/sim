import { EmailBisonIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildEmailBisonEmailAccountAddedOutputs,
  buildEmailBisonExtraFields,
  emailBisonSetupInstructions,
  emailBisonTriggerOptions,
} from '@/triggers/emailbison/utils'
import type { TriggerConfig } from '@/triggers/types'

export const emailBisonEmailAccountAddedTrigger: TriggerConfig = {
  id: 'emailbison_email_account_added',
  name: 'Email Bison Email Account Added',
  provider: 'emailbison',
  description: 'Trigger when a sender email account is added to Email Bison',
  version: '1.0.0',
  icon: EmailBisonIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'emailbison_email_account_added',
    triggerOptions: emailBisonTriggerOptions,
    setupInstructions: emailBisonSetupInstructions('Email Account Added'),
    extraFields: buildEmailBisonExtraFields('emailbison_email_account_added'),
  }),
  outputs: buildEmailBisonEmailAccountAddedOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
