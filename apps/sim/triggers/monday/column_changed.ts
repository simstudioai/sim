import { MondayIcon } from '@/components/icons'
import { buildColumnChangeOutputs, buildMondaySubBlocks } from '@/triggers/monday/utils'
import type { TriggerConfig } from '@/triggers/types'

export const mondayColumnChangedTrigger: TriggerConfig = {
  id: 'monday_column_changed',
  name: 'Monday Column Value Changed',
  provider: 'monday',
  description: 'Trigger workflow when any column value changes on a Monday.com board',
  version: '1.0.0',
  icon: MondayIcon,
  subBlocks: buildMondaySubBlocks({
    triggerId: 'monday_column_changed',
    eventType: 'Column Value Changed',
  }),
  outputs: buildColumnChangeOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
