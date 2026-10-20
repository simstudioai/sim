import { HelpScoutIcon } from '@/components/icons'
import {
  buildConversationEventOutputs,
  buildHelpScoutTriggerFields,
  helpScoutSetupInstructions,
  helpScoutTriggerOptions,
} from '@/triggers/helpscout/utils'
import { buildTriggerSubBlocks } from '@/triggers/subblocks'
import type { TriggerConfig } from '@/triggers/types'

export const helpScoutConversationMergedTrigger: TriggerConfig = {
  id: 'helpscout_conversation_merged',
  name: 'Help Scout Conversation Merged',
  provider: 'helpscout',
  description: 'Trigger workflow when Help Scout conversations are merged',
  version: '1.0.0',
  icon: HelpScoutIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'helpscout_conversation_merged',
    triggerOptions: helpScoutTriggerOptions,
    setupInstructions: helpScoutSetupInstructions(
      'the <strong>Conversation &gt; Merged</strong> event'
    ),
    fieldsBeforeWebhookUrl: buildHelpScoutTriggerFields('helpscout_conversation_merged'),
  }),

  outputs: buildConversationEventOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
