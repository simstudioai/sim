import { HelpScoutIcon } from '@/components/icons'
import {
  buildConversationEventOutputs,
  buildHelpScoutTriggerFields,
  helpScoutSetupInstructions,
  helpScoutTriggerOptions,
} from '@/triggers/helpscout/utils'
import { buildTriggerSubBlocks } from '@/triggers/subblocks'
import type { TriggerConfig } from '@/triggers/types'

export const helpScoutConversationMovedTrigger: TriggerConfig = {
  id: 'helpscout_conversation_moved',
  name: 'Help Scout Conversation Moved',
  provider: 'helpscout',
  description: 'Trigger workflow when a Help Scout conversation is moved to another inbox',
  version: '1.0.0',
  icon: HelpScoutIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'helpscout_conversation_moved',
    triggerOptions: helpScoutTriggerOptions,
    setupInstructions: helpScoutSetupInstructions(
      'the <strong>Conversation &gt; Moved</strong> event'
    ),
    fieldsBeforeWebhookUrl: buildHelpScoutTriggerFields('helpscout_conversation_moved'),
  }),

  outputs: buildConversationEventOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
