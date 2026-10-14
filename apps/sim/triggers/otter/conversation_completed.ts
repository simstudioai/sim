import { OtterIcon } from '@/components/icons'
import {
  buildOtterOutputs,
  otterSetupInstructions,
  otterTriggerOptions,
} from '@/triggers/otter/utils'
import { buildTriggerSubBlocks } from '@/triggers/subblocks'
import type { TriggerConfig } from '@/triggers/types'

export const otterConversationCompletedTrigger: TriggerConfig = {
  id: 'otter_conversation_completed',
  name: 'Otter Conversation Completed',
  provider: 'otter',
  description:
    'Trigger workflow when an Otter conversation shared to the webhook source finishes processing',
  version: '1.0.0',
  icon: OtterIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'otter_conversation_completed',
    triggerOptions: otterTriggerOptions,
    includeDropdown: true,
    setupInstructions: otterSetupInstructions(['conversation.completed']),
  }),

  outputs: buildOtterOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
