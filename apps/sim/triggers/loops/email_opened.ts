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
 * Loops Email Opened Trigger.
 * Triggers when a recipient opens an email (campaigns and loops only).
 */
export const loopsEmailOpenedTrigger: TriggerConfig = {
  id: 'loops_email_opened',
  name: 'Loops Email Opened',
  provider: 'loops',
  description: 'Trigger workflow when a Loops email is opened',
  version: '1.0.0',
  icon: LoopsIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'loops_email_opened',
    triggerOptions: loopsTriggerOptions,
    setupInstructions: loopsSetupInstructions('email.opened'),
    extraFields: buildLoopsExtraFields('loops_email_opened'),
  }),

  outputs: buildLoopsOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
