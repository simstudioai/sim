import { CheckrIcon } from '@/components/icons'
import {
  buildCheckrSubBlocks,
  CHECKR_ALL_EVENTS_TRIGGER_ID,
  CHECKR_EVENT_OUTPUTS,
} from '@/triggers/checkr/utils'
import type { TriggerConfig } from '@/triggers/types'

export const checkrWebhookTrigger: TriggerConfig = {
  id: 'checkr_webhook',
  name: 'Checkr All Events',
  provider: 'checkr',
  description: 'Trigger workflow on any Checkr event',
  version: '1.0.0',
  icon: CheckrIcon,

  subBlocks: buildCheckrSubBlocks({
    triggerId: CHECKR_ALL_EVENTS_TRIGGER_ID,
    eventLabel: 'all',
  }),

  outputs: {
    ...CHECKR_EVENT_OUTPUTS,
    data: {
      type: 'json',
      description:
        'The event object (a report, candidate, invitation, verification, adverse action, package, continuous check, or Form I-9)',
    },
  },

  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  },
}
