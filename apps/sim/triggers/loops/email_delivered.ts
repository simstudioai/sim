import { LoopsIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildLoopsExtraFields,
  buildLoopsOutputs,
  loopsSetupInstructions,
  loopsTriggerOptions,
} from '@/triggers/loops/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Loops Email Delivered Trigger.
 * Triggers when an email is delivered to the recipient.
 *
 * This is the PRIMARY trigger — it includes the dropdown for selecting trigger type.
 */
export const loopsEmailDeliveredTrigger: TriggerConfig = {
  id: 'loops_email_delivered',
  name: 'Loops Email Delivered',
  provider: 'loops',
  description: 'Trigger workflow when a Loops email is delivered',
  version: '1.0.0',
  icon: LoopsIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'loops_email_delivered',
    triggerOptions: loopsTriggerOptions,
    includeDropdown: true,
    setupInstructions: loopsSetupInstructions('email.delivered'),
    extraFields: buildLoopsExtraFields('loops_email_delivered'),
  }),

  outputs: buildLoopsOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
