import { HelpScoutIcon } from '@/components/icons'
import {
  buildConversationDeletedOutputs,
  buildHelpScoutTriggerFields,
  helpScoutSetupInstructions,
  helpScoutTriggerOptions,
} from '@/triggers/helpscout/utils'
import { buildTriggerSubBlocks } from '@/triggers/subblocks'
import type { TriggerConfig } from '@/triggers/types'

export const helpScoutConversationDeletedTrigger: TriggerConfig = {
  id: 'helpscout_conversation_deleted',
  name: 'Help Scout Conversation Deleted',
  provider: 'helpscout',
  description: 'Trigger workflow when a Help Scout conversation is deleted',
  version: '1.0.0',
  icon: HelpScoutIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'helpscout_conversation_deleted',
    triggerOptions: helpScoutTriggerOptions,
    setupInstructions: helpScoutSetupInstructions(
      'the <strong>Conversation &gt; Deleted</strong> event'
    ),
    fieldsBeforeWebhookUrl: buildHelpScoutTriggerFields('helpscout_conversation_deleted'),
  }),

  outputs: buildConversationDeletedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
