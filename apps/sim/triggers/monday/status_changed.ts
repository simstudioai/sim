import { MondayIcon } from '@/components/icons'
import { buildColumnChangeOutputs, buildMondaySubBlocks } from '@/triggers/monday/utils'
import type { TriggerConfig } from '@/triggers/types'

export const mondayStatusChangedTrigger: TriggerConfig = {
  id: 'monday_status_changed',
  name: 'Monday Status Changed',
  provider: 'monday',
  description: 'Trigger workflow when a status column value changes on a Monday.com board',
  version: '1.0.0',
  icon: MondayIcon,
  subBlocks: buildMondaySubBlocks({
    triggerId: 'monday_status_changed',
    eventType: 'Status Changed',
  }),
  outputs: buildColumnChangeOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
