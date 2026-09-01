import { AshbyIcon } from '@/components/icons'
import { buildAshbySubBlocks, buildOpeningCreateOutputs } from '@/triggers/ashby/utils'
import type { TriggerConfig } from '@/triggers/types'
export const ashbyOpeningCreateTrigger: TriggerConfig = {
  id: 'ashby_opening_create',
  name: 'Ashby Opening Created',
  provider: 'ashby',
  description: 'Trigger workflow when a headcount opening is created',
  version: '1.0.0',
  icon: AshbyIcon,
  subBlocks: buildAshbySubBlocks({
    triggerId: 'ashby_opening_create',
    eventType: 'Opening Created',
  }),
  outputs: buildOpeningCreateOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
