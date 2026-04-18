import { MondayIcon } from '@/components/icons'
import { buildItemOutputs, buildMondaySubBlocks } from '@/triggers/monday/utils'
import type { TriggerConfig } from '@/triggers/types'

export const mondayItemDeletedTrigger: TriggerConfig = {
  id: 'monday_item_deleted',
  name: 'Monday Item Deleted',
  provider: 'monday',
  description: 'Trigger workflow when an item is deleted on a Monday.com board',
  version: '1.0.0',
  icon: MondayIcon,
  subBlocks: buildMondaySubBlocks({
    triggerId: 'monday_item_deleted',
    eventType: 'Item Deleted',
  }),
  outputs: buildItemOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
