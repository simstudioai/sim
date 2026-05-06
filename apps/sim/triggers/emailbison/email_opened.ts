import { EmailBisonIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildEmailBisonEmailOpenedOutputs,
  buildEmailBisonExtraFields,
  emailBisonSetupInstructions,
  emailBisonTriggerOptions,
} from '@/triggers/emailbison/utils'
import type { TriggerConfig } from '@/triggers/types'

export const emailBisonEmailOpenedTrigger: TriggerConfig = {
  id: 'emailbison_email_opened',
  name: 'Email Bison Email Opened',
  provider: 'emailbison',
  description: 'Trigger when an Email Bison campaign email is opened',
  version: '1.0.0',
  icon: EmailBisonIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'emailbison_email_opened',
    triggerOptions: emailBisonTriggerOptions,
    setupInstructions: emailBisonSetupInstructions('Email Opened'),
    extraFields: buildEmailBisonExtraFields('emailbison_email_opened'),
  }),
  outputs: buildEmailBisonEmailOpenedOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
