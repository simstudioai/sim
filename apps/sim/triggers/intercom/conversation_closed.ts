import { IntercomIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildIntercomConversationOutputs,
  buildIntercomExtraFields,
  intercomSetupInstructions,
  intercomTriggerOptions,
} from '@/triggers/intercom/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Intercom Conversation Closed Trigger
 *
 * Fires when an admin closes a conversation.
 */
export const intercomConversationClosedTrigger: TriggerConfig = {
  id: 'intercom_conversation_closed',
  name: 'Intercom Conversation Closed',
  provider: 'intercom',
  description: 'Trigger workflow when a conversation is closed in Intercom',
  version: '1.0.0',
  icon: IntercomIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'intercom_conversation_closed',
    triggerOptions: intercomTriggerOptions,
    setupInstructions: intercomSetupInstructions('conversation.admin.closed'),
    extraFields: buildIntercomExtraFields('intercom_conversation_closed'),
  }),

  outputs: buildIntercomConversationOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
