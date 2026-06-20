import { ZendeskIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import {
  buildZendeskExtraFields,
  buildZendeskTicketOutputs,
  zendeskSetupInstructions,
  zendeskTriggerOptions,
} from '@/triggers/zendesk/utils'

export const zendeskTicketPriorityChangedTrigger: TriggerConfig = {
  id: 'zendesk_ticket_priority_changed',
  name: 'Zendesk Ticket Priority Changed',
  provider: 'zendesk',
  description: 'Trigger workflow when a ticket priority changes in Zendesk',
  version: '1.0.0',
  icon: ZendeskIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'zendesk_ticket_priority_changed',
    triggerOptions: zendeskTriggerOptions,
    setupInstructions: zendeskSetupInstructions('Ticket Priority Changed'),
    extraFields: buildZendeskExtraFields('zendesk_ticket_priority_changed'),
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
