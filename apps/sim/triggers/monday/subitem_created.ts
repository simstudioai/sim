import { MondayIcon } from '@/components/icons'
import { buildMondaySubBlocks, buildSubitemOutputs } from '@/triggers/monday/utils'
import type { TriggerConfig } from '@/triggers/types'

export const mondaySubitemCreatedTrigger: TriggerConfig = {
  id: 'monday_subitem_created',
  name: 'Monday Subitem Created',
  provider: 'monday',
  description: 'Trigger workflow when a subitem is created on a Monday.com board',
  version: '1.0.0',
  icon: MondayIcon,
  subBlocks: buildMondaySubBlocks({
    triggerId: 'monday_subitem_created',
    eventType: 'Subitem Created',
  }),
  outputs: buildSubitemOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
