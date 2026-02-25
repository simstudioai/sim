import { ConfluenceIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildConfluenceExtraFields,
  buildLabelOutputs,
  confluenceSetupInstructions,
  confluenceTriggerOptions,
} from '@/triggers/confluence/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Confluence Label Removed Trigger
 *
 * Triggers when a label is removed from a page, blog post, or other content in Confluence.
 */
export const confluenceLabelRemovedTrigger: TriggerConfig = {
  id: 'confluence_label_removed',
  name: 'Confluence Label Removed',
  provider: 'confluence',
  description: 'Trigger workflow when a label is removed from content in Confluence',
  version: '1.0.0',
  icon: ConfluenceIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'confluence_label_removed',
    triggerOptions: confluenceTriggerOptions,
    setupInstructions: confluenceSetupInstructions('label_removed'),
    extraFields: buildConfluenceExtraFields('confluence_label_removed'),
  }),

  outputs: buildLabelOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
