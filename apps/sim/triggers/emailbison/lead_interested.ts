import { EmailBisonIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildEmailBisonExtraFields,
  buildEmailBisonLeadInterestedOutputs,
  emailBisonSetupInstructions,
  emailBisonTriggerOptions,
} from '@/triggers/emailbison/utils'
import type { TriggerConfig } from '@/triggers/types'

export const emailBisonLeadInterestedTrigger: TriggerConfig = {
  id: 'emailbison_lead_interested',
  name: 'Email Bison Contact Interested',
  provider: 'emailbison',
  description: 'Trigger when a reply is marked interested in Email Bison',
  version: '1.0.0',
  icon: EmailBisonIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'emailbison_lead_interested',
    triggerOptions: emailBisonTriggerOptions,
    setupInstructions: emailBisonSetupInstructions('Contact Interested'),
    extraFields: buildEmailBisonExtraFields('emailbison_lead_interested'),
  }),
  outputs: buildEmailBisonLeadInterestedOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
