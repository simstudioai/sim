import { ZendeskIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import {
  buildZendeskExtraFields,
  buildZendeskTicketOutputs,
  zendeskSetupInstructions,
  zendeskTriggerOptions,
} from '@/triggers/zendesk/utils'

export const zendeskWebhookTrigger: TriggerConfig = {
  id: 'zendesk_webhook',
  name: 'Zendesk Ticket Event',
  provider: 'zendesk',
  description: 'Trigger workflow from any Zendesk ticket event',
  version: '1.0.0',
  icon: ZendeskIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'zendesk_webhook',
    triggerOptions: zendeskTriggerOptions,
    setupInstructions: zendeskSetupInstructions('the ticket events you want'),
    extraFields: buildZendeskExtraFields('zendesk_webhook'),
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
