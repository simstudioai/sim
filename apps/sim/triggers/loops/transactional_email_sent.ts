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
 * Loops Transactional Email Sent Trigger.
 * Triggers when a transactional email is sent to a contact.
 */
export const loopsTransactionalEmailSentTrigger: TriggerConfig = {
  id: 'loops_transactional_email_sent',
  name: 'Loops Transactional Email Sent',
  provider: 'loops',
  description: 'Trigger workflow when a Loops transactional email is sent',
  version: '1.0.0',
  icon: LoopsIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'loops_transactional_email_sent',
    triggerOptions: loopsTriggerOptions,
    setupInstructions: loopsSetupInstructions('transactional.email.sent'),
    extraFields: buildLoopsExtraFields('loops_transactional_email_sent'),
  }),

  outputs: buildLoopsSentOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
