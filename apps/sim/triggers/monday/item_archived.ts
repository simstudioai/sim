import { MondayIcon } from '@/components/icons'
import { buildItemOutputs, buildMondaySubBlocks } from '@/triggers/monday/utils'
import type { TriggerConfig } from '@/triggers/types'

export const mondayItemArchivedTrigger: TriggerConfig = {
  id: 'monday_item_archived',
  name: 'Monday Item Archived',
  provider: 'monday',
  description: 'Trigger workflow when an item is archived on a Monday.com board',
  version: '1.0.0',
  icon: MondayIcon,
  subBlocks: buildMondaySubBlocks({
    triggerId: 'monday_item_archived',
    eventType: 'Item Archived',
  }),
  outputs: buildItemOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
