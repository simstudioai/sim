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
 * Confluence Label Added Trigger
 *
 * Triggers when a label is added to a page, blog post, or other content in Confluence.
 */
export const confluenceLabelAddedTrigger: TriggerConfig = {
  id: 'confluence_label_added',
  name: 'Confluence Label Added',
  provider: 'confluence',
  description: 'Trigger workflow when a label is added to content in Confluence',
  version: '1.0.0',
  icon: ConfluenceIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'confluence_label_added',
    triggerOptions: confluenceTriggerOptions,
    setupInstructions: confluenceSetupInstructions('label_added'),
    extraFields: buildConfluenceExtraFields('confluence_label_added'),
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
