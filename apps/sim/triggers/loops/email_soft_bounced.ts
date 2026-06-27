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
 * Loops Email Soft Bounced Trigger.
 * Triggers on a temporary email delivery failure.
 */
export const loopsEmailSoftBouncedTrigger: TriggerConfig = {
  id: 'loops_email_soft_bounced',
  name: 'Loops Email Soft Bounced',
  provider: 'loops',
  description: 'Trigger workflow when a Loops email soft bounces',
  version: '1.0.0',
  icon: LoopsIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'loops_email_soft_bounced',
    triggerOptions: loopsTriggerOptions,
    setupInstructions: loopsSetupInstructions('email.softBounced'),
    extraFields: buildLoopsExtraFields('loops_email_soft_bounced'),
  }),

  outputs: buildLoopsOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
