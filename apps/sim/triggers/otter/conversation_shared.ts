import { OtterIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildOtterOutputs,
  otterSetupInstructions,
  otterTriggerOptions,
} from '@/triggers/otter/utils'
import type { TriggerConfig } from '@/triggers/types'

export const otterConversationSharedTrigger: TriggerConfig = {
  id: 'otter_conversation_shared',
  name: 'Otter Conversation Shared',
  provider: 'otter',
  description:
    'Trigger workflow when an existing Otter conversation is shared to the webhook source',
  version: '1.0.0',
  icon: OtterIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'otter_conversation_shared',
    triggerOptions: otterTriggerOptions,
    setupInstructions: otterSetupInstructions(['conversation.shared']),
  }),

  outputs: buildOtterOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
