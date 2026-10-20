import { HelpScoutIcon } from '@/components/icons'
import {
  buildConversationEventOutputs,
  buildHelpScoutTriggerFields,
  helpScoutSetupInstructions,
  helpScoutTriggerOptions,
} from '@/triggers/helpscout/utils'
import { buildTriggerSubBlocks } from '@/triggers/subblocks'
import type { TriggerConfig } from '@/triggers/types'

export const helpScoutConversationCreatedTrigger: TriggerConfig = {
  id: 'helpscout_conversation_created',
  name: 'Help Scout Conversation Created',
  provider: 'helpscout',
  description: 'Trigger workflow when a conversation is created in Help Scout',
  version: '1.0.0',
  icon: HelpScoutIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'helpscout_conversation_created',
    triggerOptions: helpScoutTriggerOptions,
    includeDropdown: true,
    setupInstructions: helpScoutSetupInstructions(
      'the <strong>Conversation &gt; Created</strong> event'
    ),
    fieldsBeforeWebhookUrl: buildHelpScoutTriggerFields('helpscout_conversation_created'),
  }),

  outputs: buildConversationEventOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
