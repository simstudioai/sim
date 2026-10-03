import { AshbyIcon } from '@/components/icons'
import { buildAshbySubBlocks, buildOfferUpdateOutputs } from '@/triggers/ashby/utils'
import type { TriggerConfig } from '@/triggers/types'
export const ashbyOfferUpdateTrigger: TriggerConfig = {
  id: 'ashby_offer_update',
  name: 'Ashby Offer Updated',
  provider: 'ashby',
  description: 'Trigger workflow when an offer is updated',
  version: '1.0.0',
  icon: AshbyIcon,
  subBlocks: buildAshbySubBlocks({ triggerId: 'ashby_offer_update', eventType: 'Offer Updated' }),
  outputs: buildOfferUpdateOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
