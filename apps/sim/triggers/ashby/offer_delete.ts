import { AshbyIcon } from '@/components/icons'
import { buildAshbySubBlocks, buildOfferDeleteOutputs } from '@/triggers/ashby/utils'
import type { TriggerConfig } from '@/triggers/types'
export const ashbyOfferDeleteTrigger: TriggerConfig = {
  id: 'ashby_offer_delete',
  name: 'Ashby Offer Deleted',
  provider: 'ashby',
  description: 'Trigger workflow when an offer is deleted',
  version: '1.0.0',
  icon: AshbyIcon,
  subBlocks: buildAshbySubBlocks({ triggerId: 'ashby_offer_delete', eventType: 'Offer Deleted' }),
  outputs: buildOfferDeleteOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
