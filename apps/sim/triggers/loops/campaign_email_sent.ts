import { LoopsIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildLoopsExtraFields,
  buildLoopsSentOutputs,
  loopsSetupInstructions,
  loopsTriggerOptions,
} from '@/triggers/loops/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Loops Campaign Email Sent Trigger.
 * Triggers when a campaign email is sent to a contact.
 */
export const loopsCampaignEmailSentTrigger: TriggerConfig = {
  id: 'loops_campaign_email_sent',
  name: 'Loops Campaign Email Sent',
  provider: 'loops',
  description: 'Trigger workflow when a Loops campaign email is sent',
  version: '1.0.0',
  icon: LoopsIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'loops_campaign_email_sent',
    triggerOptions: loopsTriggerOptions,
    setupInstructions: loopsSetupInstructions('campaign.email.sent'),
    extraFields: buildLoopsExtraFields('loops_campaign_email_sent'),
  }),

  outputs: buildLoopsSentOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
