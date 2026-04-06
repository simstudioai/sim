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
 * Intercom Conversation Reply Trigger
 *
 * Fires when a user, lead, or admin replies to a conversation.
 */
export const intercomConversationReplyTrigger: TriggerConfig = {
  id: 'intercom_conversation_reply',
  name: 'Intercom Conversation Reply',
  provider: 'intercom',
  description: 'Trigger workflow when someone replies to an Intercom conversation',
  version: '1.0.0',
  icon: IntercomIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'intercom_conversation_reply',
    triggerOptions: intercomTriggerOptions,
    setupInstructions: intercomSetupInstructions(
      'conversation.user.replied and/or conversation.admin.replied'
    ),
    extraFields: buildIntercomExtraFields('intercom_conversation_reply'),
  }),

  outputs: buildIntercomConversationOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
