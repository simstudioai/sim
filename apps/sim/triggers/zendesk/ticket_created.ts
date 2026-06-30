import { ZendeskIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import {
  buildZendeskExtraFields,
  buildZendeskTicketOutputs,
  zendeskSetupInstructions,
  zendeskTriggerOptions,
} from '@/triggers/zendesk/utils'

export const zendeskTicketCreatedTrigger: TriggerConfig = {
  id: 'zendesk_ticket_created',
  name: 'Zendesk Ticket Created',
  provider: 'zendesk',
  description: 'Trigger workflow when a new ticket is created in Zendesk',
  version: '1.0.0',
  icon: ZendeskIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'zendesk_ticket_created',
    triggerOptions: zendeskTriggerOptions,
    includeDropdown: true,
    setupInstructions: zendeskSetupInstructions('Ticket Created'),
    extraFields: buildZendeskExtraFields('zendesk_ticket_created'),
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
