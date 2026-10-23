import { HelpScoutIcon } from '@/components/icons'
import {
  buildConversationEventOutputs,
  buildHelpScoutTriggerFields,
  helpScoutSetupInstructions,
  helpScoutTriggerOptions,
} from '@/triggers/helpscout/utils'
import { buildTriggerSubBlocks } from '@/triggers/subblocks'
import type { TriggerConfig } from '@/triggers/types'

export const helpScoutConversationTagsUpdatedTrigger: TriggerConfig = {
  id: 'helpscout_conversation_tags_updated',
  name: 'Help Scout Conversation Tags Updated',
  provider: 'helpscout',
  description: 'Trigger workflow when the tags on a Help Scout conversation change',
  version: '1.0.0',
  icon: HelpScoutIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'helpscout_conversation_tags_updated',
    triggerOptions: helpScoutTriggerOptions,
    setupInstructions: helpScoutSetupInstructions(
      'the <strong>Conversation &gt; Tags Updated</strong> event'
    ),
    fieldsBeforeWebhookUrl: buildHelpScoutTriggerFields('helpscout_conversation_tags_updated'),
  }),

  outputs: buildConversationEventOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
