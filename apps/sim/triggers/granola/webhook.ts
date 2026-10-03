import { GranolaIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildGranolaExtraFields,
  buildGranolaOutputs,
  granolaSetupInstructions,
  granolaTriggerOptions,
} from '@/triggers/granola/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Trigger workflow on any Granola note event
 */
export const granolaWebhookTrigger: TriggerConfig = {
  id: 'granola_webhook',
  name: 'Granola Events',
  provider: 'granola',
  description: 'Trigger workflow on any Granola note event',
  version: '1.0.0',
  icon: GranolaIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'granola_webhook',
    triggerOptions: granolaTriggerOptions,
    setupInstructions: granolaSetupInstructions('all note events'),
    extraFields: buildGranolaExtraFields('granola_webhook'),
  }),

  outputs: buildGranolaOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
