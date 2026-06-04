import { EmailBisonIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildEmailBisonExtraFields,
  buildEmailBisonLeadUnsubscribedOutputs,
  emailBisonSetupInstructions,
  emailBisonTriggerOptions,
} from '@/triggers/emailbison/utils'
import type { TriggerConfig } from '@/triggers/types'

export const emailBisonLeadUnsubscribedTrigger: TriggerConfig = {
  id: 'emailbison_lead_unsubscribed',
  name: 'Email Bison Contact Unsubscribed',
  provider: 'emailbison',
  description: 'Trigger when a contact unsubscribes in Email Bison',
  version: '1.0.0',
  icon: EmailBisonIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'emailbison_lead_unsubscribed',
    triggerOptions: emailBisonTriggerOptions,
    setupInstructions: emailBisonSetupInstructions('Contact Unsubscribed'),
    extraFields: buildEmailBisonExtraFields('emailbison_lead_unsubscribed'),
  }),
  outputs: buildEmailBisonLeadUnsubscribedOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
