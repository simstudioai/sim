import { AshbyIcon } from '@/components/icons'
import { buildAshbySubBlocks, buildOfferCreateOutputs } from '@/triggers/ashby/utils'
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

  subBlocks: buildAshbySubBlocks({
    triggerId: 'ashby_offer_create',
    eventType: 'Offer Created',
  }),

  outputs: buildOfferCreateOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
