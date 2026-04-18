import { MondayIcon } from '@/components/icons'
import { buildMondaySubBlocks, buildUpdateOutputs } from '@/triggers/monday/utils'
import type { TriggerConfig } from '@/triggers/types'

export const mondayUpdateCreatedTrigger: TriggerConfig = {
  id: 'monday_update_created',
  name: 'Monday Update Posted',
  provider: 'monday',
  description: 'Trigger workflow when an update or comment is posted on a Monday.com item',
  version: '1.0.0',
  icon: MondayIcon,
  subBlocks: buildMondaySubBlocks({
    triggerId: 'monday_update_created',
    eventType: 'Update Posted',
  }),
  outputs: buildUpdateOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
