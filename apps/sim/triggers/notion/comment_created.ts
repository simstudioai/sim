import { NotionIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildCommentEventOutputs,
  buildNotionExtraFields,
  notionSetupInstructions,
  notionTriggerOptions,
} from '@/triggers/notion/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Notion Comment Created Trigger
 */
export const notionCommentCreatedTrigger: TriggerConfig = {
  id: 'notion_comment_created',
  name: 'Notion Comment Created',
  provider: 'notion',
  description: 'Trigger workflow when a comment or suggested edit is added in Notion',
  version: '1.0.0',
  icon: NotionIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'notion_comment_created',
    triggerOptions: notionTriggerOptions,
    setupInstructions: notionSetupInstructions('comment.created'),
    extraFields: buildNotionExtraFields('notion_comment_created'),
  }),

  outputs: buildCommentEventOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Notion-Signature': 'sha256=...',
    },
  },
}
