import { MondayIcon } from '@/components/icons'
import { buildItemMovedOutputs, buildMondaySubBlocks } from '@/triggers/monday/utils'
import type { TriggerConfig } from '@/triggers/types'

export const mondayItemMovedTrigger: TriggerConfig = {
  id: 'monday_item_moved',
  name: 'Monday Item Moved to Group',
  provider: 'monday',
  description: 'Trigger workflow when an item is moved to any group on a Monday.com board',
  version: '1.0.0',
  icon: MondayIcon,
  subBlocks: buildMondaySubBlocks({
    triggerId: 'monday_item_moved',
    eventType: 'Item Moved to Group',
  }),
  outputs: buildItemMovedOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
