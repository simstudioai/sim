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
 * Loops Email Hard Bounced Trigger.
 * Triggers on a permanent email delivery failure.
 */
export const loopsEmailHardBouncedTrigger: TriggerConfig = {
  id: 'loops_email_hard_bounced',
  name: 'Loops Email Hard Bounced',
  provider: 'loops',
  description: 'Trigger workflow when a Loops email hard bounces',
  version: '1.0.0',
  icon: LoopsIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'loops_email_hard_bounced',
    triggerOptions: loopsTriggerOptions,
    setupInstructions: loopsSetupInstructions('email.hardBounced'),
    extraFields: buildLoopsExtraFields('loops_email_hard_bounced'),
  }),

  outputs: buildLoopsOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
