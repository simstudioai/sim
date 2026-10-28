import { HelpScoutIcon } from '@/components/icons'
import {
  buildConversationEventOutputs,
  buildHelpScoutTriggerFields,
  helpScoutSetupInstructions,
  helpScoutTriggerOptions,
} from '@/triggers/helpscout/utils'
import { buildTriggerSubBlocks } from '@/triggers/subblocks'
import type { TriggerConfig } from '@/triggers/types'

export const helpScoutCustomerRepliedTrigger: TriggerConfig = {
  id: 'helpscout_customer_replied',
  name: 'Help Scout Customer Replied',
  provider: 'helpscout',
  description: 'Trigger workflow when a customer replies to a Help Scout conversation',
  version: '1.0.0',
  icon: HelpScoutIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'helpscout_customer_replied',
    triggerOptions: helpScoutTriggerOptions,
    setupInstructions: helpScoutSetupInstructions(
      'the <strong>Conversation &gt; Customer Reply</strong> event'
    ),
    fieldsBeforeWebhookUrl: buildHelpScoutTriggerFields('helpscout_customer_replied'),
  }),

  outputs: buildConversationEventOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
