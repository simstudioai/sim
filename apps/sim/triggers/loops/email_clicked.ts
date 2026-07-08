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
 * Loops Email Clicked Trigger.
 * Triggers when a recipient clicks a link in an email (campaigns and loops only).
 */
export const loopsEmailClickedTrigger: TriggerConfig = {
  id: 'loops_email_clicked',
  name: 'Loops Email Clicked',
  provider: 'loops',
  description: 'Trigger workflow when a link in a Loops email is clicked',
  version: '1.0.0',
  icon: LoopsIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'loops_email_clicked',
    triggerOptions: loopsTriggerOptions,
    setupInstructions: loopsSetupInstructions('email.clicked'),
    extraFields: buildLoopsExtraFields('loops_email_clicked'),
  }),

  outputs: buildLoopsOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
