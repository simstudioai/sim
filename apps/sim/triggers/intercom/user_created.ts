import { IntercomIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildIntercomContactOutputs,
  buildIntercomExtraFields,
  intercomSetupInstructions,
  intercomTriggerOptions,
} from '@/triggers/intercom/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Intercom User Created Trigger
 *
 * Fires when a new identified user is created in Intercom.
 * Note: In Intercom, user.created fires for identified users only.
 * For anonymous leads, use the Contact Created trigger (contact.created topic).
 */
export const intercomUserCreatedTrigger: TriggerConfig = {
  id: 'intercom_user_created',
  name: 'Intercom User Created',
  provider: 'intercom',
  description: 'Trigger workflow when a new user is created in Intercom',
  version: '1.0.0',
  icon: IntercomIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'intercom_user_created',
    triggerOptions: intercomTriggerOptions,
    setupInstructions: intercomSetupInstructions('user.created'),
    extraFields: buildIntercomExtraFields('intercom_user_created'),
  }),

  outputs: buildIntercomContactOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
