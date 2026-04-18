import { ConfluenceIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildConfluenceExtraFields,
  buildPagePermissionsOutputs,
  confluenceSetupInstructions,
  confluenceTriggerOptions,
} from '@/triggers/confluence/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Confluence Page Permissions Updated Trigger
 *
 * Triggers when page permissions are changed in Confluence.
 */
export const confluencePagePermissionsUpdatedTrigger: TriggerConfig = {
  id: 'confluence_page_permissions_updated',
  name: 'Confluence Page Permissions Updated',
  provider: 'confluence',
  description: 'Trigger workflow when page permissions are changed in Confluence',
  version: '1.0.0',
  icon: ConfluenceIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'confluence_page_permissions_updated',
    triggerOptions: confluenceTriggerOptions,
    setupInstructions: confluenceSetupInstructions('content_permissions_updated'),
    extraFields: buildConfluenceExtraFields('confluence_page_permissions_updated'),
  }),

  outputs: buildPagePermissionsOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
