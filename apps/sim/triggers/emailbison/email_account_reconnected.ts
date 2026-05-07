import { EmailBisonIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildEmailBisonEmailAccountReconnectedOutputs,
  buildEmailBisonExtraFields,
  emailBisonSetupInstructions,
  emailBisonTriggerOptions,
} from '@/triggers/emailbison/utils'
import type { TriggerConfig } from '@/triggers/types'

export const emailBisonEmailAccountReconnectedTrigger: TriggerConfig = {
  id: 'emailbison_email_account_reconnected',
  name: 'Email Bison Email Account Reconnected',
  provider: 'emailbison',
  description: 'Trigger when a sender email account reconnects in Email Bison',
  version: '1.0.0',
  icon: EmailBisonIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'emailbison_email_account_reconnected',
    triggerOptions: emailBisonTriggerOptions,
    setupInstructions: emailBisonSetupInstructions('Email Account Reconnected'),
    extraFields: buildEmailBisonExtraFields('emailbison_email_account_reconnected'),
  }),
  outputs: buildEmailBisonEmailAccountReconnectedOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
