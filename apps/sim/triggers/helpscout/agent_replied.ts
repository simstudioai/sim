import { HelpScoutIcon } from '@/components/icons'
import {
  buildConversationEventOutputs,
  buildHelpScoutTriggerFields,
  helpScoutSetupInstructions,
  helpScoutTriggerOptions,
} from '@/triggers/helpscout/utils'
import { buildTriggerSubBlocks } from '@/triggers/subblocks'
import type { TriggerConfig } from '@/triggers/types'

export const helpScoutAgentRepliedTrigger: TriggerConfig = {
  id: 'helpscout_agent_replied',
  name: 'Help Scout Agent Replied',
  provider: 'helpscout',
  description:
    'Trigger workflow when an agent replies to a Help Scout conversation (auto replies are not included)',
  version: '1.0.0',
  icon: HelpScoutIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'helpscout_agent_replied',
    triggerOptions: helpScoutTriggerOptions,
    setupInstructions: helpScoutSetupInstructions(
      'the <strong>Conversation &gt; Agent Reply</strong> event'
    ),
    fieldsBeforeWebhookUrl: buildHelpScoutTriggerFields('helpscout_agent_replied'),
  }),

  outputs: buildConversationEventOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
