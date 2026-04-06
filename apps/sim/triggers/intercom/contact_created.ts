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
 * Intercom Contact Created Trigger
 *
 * Fires when a new lead is created in Intercom.
 * Note: In Intercom, contact.created fires for leads only.
 * For identified users, use the User Created trigger (user.created topic).
 */
export const intercomContactCreatedTrigger: TriggerConfig = {
  id: 'intercom_contact_created',
  name: 'Intercom Contact Created',
  provider: 'intercom',
  description: 'Trigger workflow when a new lead is created in Intercom',
  version: '1.0.0',
  icon: IntercomIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'intercom_contact_created',
    triggerOptions: intercomTriggerOptions,
    setupInstructions: intercomSetupInstructions('contact.created'),
    extraFields: buildIntercomExtraFields('intercom_contact_created'),
  }),

  outputs: buildIntercomContactOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
