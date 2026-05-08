import { EmailBisonIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildEmailBisonEmailAccountDisconnectedOutputs,
  buildEmailBisonExtraFields,
  emailBisonSetupInstructions,
  emailBisonTriggerOptions,
} from '@/triggers/emailbison/utils'
import type { TriggerConfig } from '@/triggers/types'

export const emailBisonEmailAccountDisconnectedTrigger: TriggerConfig = {
  id: 'emailbison_email_account_disconnected',
  name: 'Email Bison Email Account Disconnected',
  provider: 'emailbison',
  description: 'Trigger when a sender email account disconnects in Email Bison',
  version: '1.0.0',
  icon: EmailBisonIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'emailbison_email_account_disconnected',
    triggerOptions: emailBisonTriggerOptions,
    setupInstructions: emailBisonSetupInstructions('Email Account Disconnected'),
    extraFields: buildEmailBisonExtraFields('emailbison_email_account_disconnected'),
  }),
  outputs: buildEmailBisonEmailAccountDisconnectedOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
