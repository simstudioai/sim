import { EmailBisonIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildEmailBisonExtraFields,
  buildEmailBisonLeadFirstContactedOutputs,
  emailBisonSetupInstructions,
  emailBisonTriggerOptions,
} from '@/triggers/emailbison/utils'
import type { TriggerConfig } from '@/triggers/types'

export const emailBisonLeadFirstContactedTrigger: TriggerConfig = {
  id: 'emailbison_lead_first_contacted',
  name: 'Email Bison Contact First Emailed',
  provider: 'emailbison',
  description: 'Trigger when a contact receives their first campaign email in Email Bison',
  version: '1.0.0',
  icon: EmailBisonIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'emailbison_lead_first_contacted',
    triggerOptions: emailBisonTriggerOptions,
    setupInstructions: emailBisonSetupInstructions('Contact First Emailed'),
    extraFields: buildEmailBisonExtraFields('emailbison_lead_first_contacted'),
  }),
  outputs: buildEmailBisonLeadFirstContactedOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
