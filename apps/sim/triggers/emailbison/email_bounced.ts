import { EmailBisonIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildEmailBisonEmailBouncedOutputs,
  buildEmailBisonExtraFields,
  emailBisonSetupInstructions,
  emailBisonTriggerOptions,
} from '@/triggers/emailbison/utils'
import type { TriggerConfig } from '@/triggers/types'

export const emailBisonEmailBouncedTrigger: TriggerConfig = {
  id: 'emailbison_email_bounced',
  name: 'Email Bison Email Bounced',
  provider: 'emailbison',
  description: 'Trigger when an Email Bison campaign email bounces',
  version: '1.0.0',
  icon: EmailBisonIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'emailbison_email_bounced',
    triggerOptions: emailBisonTriggerOptions,
    setupInstructions: emailBisonSetupInstructions('Email Bounced'),
    extraFields: buildEmailBisonExtraFields('emailbison_email_bounced'),
  }),
  outputs: buildEmailBisonEmailBouncedOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
