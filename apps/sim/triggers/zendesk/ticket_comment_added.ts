import { ZendeskIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import {
  buildZendeskExtraFields,
  buildZendeskTicketOutputs,
  zendeskSetupInstructions,
  zendeskTriggerOptions,
} from '@/triggers/zendesk/utils'

export const zendeskTicketCommentAddedTrigger: TriggerConfig = {
  id: 'zendesk_ticket_comment_added',
  name: 'Zendesk Ticket Comment Added',
  provider: 'zendesk',
  description: 'Trigger workflow when a comment is added to a Zendesk ticket',
  version: '1.0.0',
  icon: ZendeskIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'zendesk_ticket_comment_added',
    triggerOptions: zendeskTriggerOptions,
    setupInstructions: zendeskSetupInstructions('Ticket Comment Added'),
    extraFields: buildZendeskExtraFields('zendesk_ticket_comment_added'),
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
