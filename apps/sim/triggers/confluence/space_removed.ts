import { ConfluenceIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildConfluenceExtraFields,
  buildSpaceOutputs,
  confluenceSetupInstructions,
  confluenceTriggerOptions,
} from '@/triggers/confluence/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Confluence Space Removed Trigger
 *
 * Triggers when a space is deleted/removed in Confluence.
 */
export const confluenceSpaceRemovedTrigger: TriggerConfig = {
  id: 'confluence_space_removed',
  name: 'Confluence Space Removed',
  provider: 'confluence',
  description: 'Trigger workflow when a space is removed in Confluence',
  version: '1.0.0',
  icon: ConfluenceIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'confluence_space_removed',
    triggerOptions: confluenceTriggerOptions,
    setupInstructions: confluenceSetupInstructions('space_removed'),
    extraFields: buildConfluenceExtraFields('confluence_space_removed'),
  }),

  outputs: buildSpaceOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
