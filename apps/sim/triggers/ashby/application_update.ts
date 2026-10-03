import { AshbyIcon } from '@/components/icons'
import { buildApplicationUpdateOutputs, buildAshbySubBlocks } from '@/triggers/ashby/utils'
import type { TriggerConfig } from '@/triggers/types'
export const ashbyApplicationUpdateTrigger: TriggerConfig = {
  id: 'ashby_application_update',
  name: 'Ashby Application Updated',
  provider: 'ashby',
  description: 'Trigger workflow when an application is updated',
  version: '1.0.0',
  icon: AshbyIcon,
  subBlocks: buildAshbySubBlocks({
    triggerId: 'ashby_application_update',
    eventType: 'Application Updated',
  }),
  outputs: buildApplicationUpdateOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
