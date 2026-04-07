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
 * Intercom Conversation Created Trigger
 *
 * This is the PRIMARY trigger - it includes the dropdown for selecting trigger type.
 * Fires when a user/lead starts a new conversation or an admin initiates a 1:1 conversation.
 */
export const intercomConversationCreatedTrigger: TriggerConfig = {
  id: 'intercom_conversation_created',
  name: 'Intercom Conversation Created',
  provider: 'intercom',
  description: 'Trigger workflow when a new conversation is created in Intercom',
  version: '1.0.0',
  icon: IntercomIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'intercom_conversation_created',
    triggerOptions: intercomTriggerOptions,
    includeDropdown: true,
    setupInstructions: intercomSetupInstructions(
      'conversation.user.created and/or conversation.admin.single.created'
    ),
    extraFields: buildIntercomExtraFields('intercom_conversation_created'),
  }),

  outputs: buildIntercomConversationOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
