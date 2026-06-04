import { MondayIcon } from '@/components/icons'
import { buildItemOutputs, buildMondaySubBlocks } from '@/triggers/monday/utils'
import type { TriggerConfig } from '@/triggers/types'

export const mondayItemCreatedTrigger: TriggerConfig = {
  id: 'monday_item_created',
  name: 'Monday Item Created',
  provider: 'monday',
  description: 'Trigger workflow when a new item is created on a Monday.com board',
  version: '1.0.0',
  icon: MondayIcon,
  subBlocks: buildMondaySubBlocks({
    triggerId: 'monday_item_created',
    eventType: 'Item Created',
    includeDropdown: true,
  }),
  outputs: buildItemOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
