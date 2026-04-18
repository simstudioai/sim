import { ConfluenceIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildConfluenceExtraFields,
  buildUserOutputs,
  confluenceSetupInstructions,
  confluenceTriggerOptions,
} from '@/triggers/confluence/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Confluence User Created Trigger
 *
 * Triggers when a new user is added to Confluence.
 */
export const confluenceUserCreatedTrigger: TriggerConfig = {
  id: 'confluence_user_created',
  name: 'Confluence User Created',
  provider: 'confluence',
  description: 'Trigger workflow when a new user is added to Confluence',
  version: '1.0.0',
  icon: ConfluenceIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'confluence_user_created',
    triggerOptions: confluenceTriggerOptions,
    setupInstructions: confluenceSetupInstructions('user_created'),
    extraFields: buildConfluenceExtraFields('confluence_user_created'),
  }),

  outputs: buildUserOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
