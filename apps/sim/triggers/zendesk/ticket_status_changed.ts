import { ZendeskIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import {
  buildZendeskExtraFields,
  buildZendeskTicketOutputs,
  zendeskSetupInstructions,
  zendeskTriggerOptions,
} from '@/triggers/zendesk/utils'

export const zendeskTicketStatusChangedTrigger: TriggerConfig = {
  id: 'zendesk_ticket_status_changed',
  name: 'Zendesk Ticket Status Changed',
  provider: 'zendesk',
  description: 'Trigger workflow when a ticket status changes in Zendesk',
  version: '1.0.0',
  icon: ZendeskIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'zendesk_ticket_status_changed',
    triggerOptions: zendeskTriggerOptions,
    setupInstructions: zendeskSetupInstructions('Ticket Status Changed'),
    extraFields: buildZendeskExtraFields('zendesk_ticket_status_changed'),
  }),
  outputs: buildZendeskTicketOutputs(),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Zendesk-Webhook-Signature': '...',
      'X-Zendesk-Webhook-Signature-Timestamp': '...',
    },
  },
}
