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
 * Confluence Space Updated Trigger
 *
 * Triggers when a space is updated (settings, permissions, etc.) in Confluence.
 */
export const confluenceSpaceUpdatedTrigger: TriggerConfig = {
  id: 'confluence_space_updated',
  name: 'Confluence Space Updated',
  provider: 'confluence',
  description: 'Trigger workflow when a space is updated in Confluence',
  version: '1.0.0',
  icon: ConfluenceIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'confluence_space_updated',
    triggerOptions: confluenceTriggerOptions,
    setupInstructions: confluenceSetupInstructions('space_updated'),
    extraFields: buildConfluenceExtraFields('confluence_space_updated'),
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
