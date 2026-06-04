import { MondayIcon } from '@/components/icons'
import { buildColumnChangeOutputs, buildMondaySubBlocks } from '@/triggers/monday/utils'
import type { TriggerConfig } from '@/triggers/types'

export const mondayItemNameChangedTrigger: TriggerConfig = {
  id: 'monday_item_name_changed',
  name: 'Monday Item Name Changed',
  provider: 'monday',
  description: 'Trigger workflow when an item name changes on a Monday.com board',
  version: '1.0.0',
  icon: MondayIcon,
  subBlocks: buildMondaySubBlocks({
    triggerId: 'monday_item_name_changed',
    eventType: 'Item Name Changed',
  }),
  outputs: buildColumnChangeOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
