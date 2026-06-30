import { LoopsIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildLoopsExtraFields,
  buildLoopsSentOutputs,
  loopsSetupInstructions,
  loopsTriggerOptions,
} from '@/triggers/loops/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Loops Loop Email Sent Trigger.
 * Triggers when a loop (workflow) email is sent to a contact.
 */
export const loopsLoopEmailSentTrigger: TriggerConfig = {
  id: 'loops_loop_email_sent',
  name: 'Loops Loop Email Sent',
  provider: 'loops',
  description: 'Trigger workflow when a Loops loop email is sent',
  version: '1.0.0',
  icon: LoopsIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'loops_loop_email_sent',
    triggerOptions: loopsTriggerOptions,
    setupInstructions: loopsSetupInstructions('loop.email.sent'),
    extraFields: buildLoopsExtraFields('loops_loop_email_sent'),
  }),

  outputs: buildLoopsSentOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
