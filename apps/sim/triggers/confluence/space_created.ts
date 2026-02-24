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
 * Confluence Space Created Trigger
 *
 * Triggers when a new space is created in Confluence.
 */
export const confluenceSpaceCreatedTrigger: TriggerConfig = {
  id: 'confluence_space_created',
  name: 'Confluence Space Created',
  provider: 'confluence',
  description: 'Trigger workflow when a new space is created in Confluence',
  version: '1.0.0',
  icon: ConfluenceIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'confluence_space_created',
    triggerOptions: confluenceTriggerOptions,
    setupInstructions: confluenceSetupInstructions('space_created'),
    extraFields: buildConfluenceExtraFields('confluence_space_created'),
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
