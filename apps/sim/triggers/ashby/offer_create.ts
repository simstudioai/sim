import { AshbyIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  ashbySetupInstructions,
  ashbyTriggerOptions,
  buildAshbyExtraFields,
  buildOfferCreateOutputs,
} from '@/triggers/ashby/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Ashby Offer Created Trigger
 *
 * Fires when a new offer is created for a candidate.
 */
export const ashbyOfferCreateTrigger: TriggerConfig = {
  id: 'ashby_offer_create',
  name: 'Ashby Offer Created',
  provider: 'ashby',
  description: 'Trigger workflow when a new offer is created',
  version: '1.0.0',
  icon: AshbyIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'ashby_offer_create',
    triggerOptions: ashbyTriggerOptions,
    setupInstructions: ashbySetupInstructions('Offer Created'),
    extraFields: buildAshbyExtraFields('ashby_offer_create'),
  }),

  outputs: buildOfferCreateOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
