import { EmailBisonIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildEmailBisonExtraFields,
  buildEmailBisonLeadRepliedOutputs,
  emailBisonSetupInstructions,
  emailBisonTriggerOptions,
} from '@/triggers/emailbison/utils'
import type { TriggerConfig } from '@/triggers/types'

export const emailBisonLeadRepliedTrigger: TriggerConfig = {
  id: 'emailbison_lead_replied',
  name: 'Email Bison Contact Replied',
  provider: 'emailbison',
  description: 'Trigger when a campaign lead replies in Email Bison',
  version: '1.0.0',
  icon: EmailBisonIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'emailbison_lead_replied',
    triggerOptions: emailBisonTriggerOptions,
    setupInstructions: emailBisonSetupInstructions('Contact Replied'),
    extraFields: buildEmailBisonExtraFields('emailbison_lead_replied'),
  }),
  outputs: buildEmailBisonLeadRepliedOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
