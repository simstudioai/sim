import { FivetranIcon } from '@/components/icons'
import {
  buildFivetranSubBlocks,
  FIVETRAN_ALL_EVENTS_TRIGGER_ID,
  FIVETRAN_EVENT_OUTPUTS,
} from '@/triggers/fivetran/utils'
import type { TriggerConfig } from '@/triggers/types'

export const fivetranWebhookTrigger: TriggerConfig = {
  id: 'fivetran_webhook',
  name: 'Fivetran All Events',
  provider: 'fivetran',
  description: 'Trigger workflow on any Fivetran sync, connection, or transformation event',
  version: '1.0.0',
  icon: FivetranIcon,

  subBlocks: buildFivetranSubBlocks({
    triggerId: FIVETRAN_ALL_EVENTS_TRIGGER_ID,
    eventLabel: 'all',
  }),

  outputs: {
    ...FIVETRAN_EVENT_OUTPUTS,
    data: { type: 'json', description: 'Event-specific payload; its fields depend on the event' },
  },

  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
