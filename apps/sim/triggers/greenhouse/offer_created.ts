import { GreenhouseIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildGreenhouseExtraFields,
  buildOfferCreatedOutputs,
  greenhouseSetupInstructions,
  greenhouseTriggerOptions,
} from '@/triggers/greenhouse/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Greenhouse Offer Created Trigger
 *
 * Fires when a new offer is created for a candidate.
 */
export const greenhouseOfferCreatedTrigger: TriggerConfig = {
  id: 'greenhouse_offer_created',
  name: 'Greenhouse Offer Created',
  provider: 'greenhouse',
  description: 'Trigger workflow when a new offer is created',
  version: '1.0.0',
  icon: GreenhouseIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'greenhouse_offer_created',
    triggerOptions: greenhouseTriggerOptions,
    setupInstructions: greenhouseSetupInstructions('Offer Created'),
    extraFields: buildGreenhouseExtraFields('greenhouse_offer_created'),
  }),

  outputs: buildOfferCreatedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
