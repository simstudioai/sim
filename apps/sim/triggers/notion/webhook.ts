import { NotionIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildGenericWebhookOutputs,
  buildNotionExtraFields,
  notionSetupInstructions,
  notionTriggerOptions,
} from '@/triggers/notion/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Notion Generic Webhook Trigger (All Events)
 */
export const notionWebhookTrigger: TriggerConfig = {
  id: 'notion_webhook',
  name: 'Notion Webhook (All Events)',
  provider: 'notion',
  description: 'Trigger workflow on any Notion webhook event',
  version: '1.0.0',
  icon: NotionIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'notion_webhook',
    triggerOptions: notionTriggerOptions,
    setupInstructions: notionSetupInstructions('all desired'),
    extraFields: buildNotionExtraFields('notion_webhook'),
  }),

  outputs: buildGenericWebhookOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Notion-Signature': 'sha256=...',
    },
  },
}
