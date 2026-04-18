import { JiraServiceManagementIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildJsmCommentOutputs,
  buildJsmExtraFields,
  jsmSetupInstructions,
  jsmTriggerOptions,
} from '@/triggers/jsm/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * JSM Request Commented Trigger
 *
 * Triggers when a comment is added to a service request (public or internal).
 */
export const jsmRequestCommentedTrigger: TriggerConfig = {
  id: 'jsm_request_commented',
  name: 'JSM Request Commented',
  provider: 'jsm',
  description: 'Trigger workflow when a comment is added to a Jira Service Management request',
  version: '1.0.0',
  icon: JiraServiceManagementIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'jsm_request_commented',
    triggerOptions: jsmTriggerOptions,
    setupInstructions: jsmSetupInstructions('comment_created'),
    extraFields: buildJsmExtraFields('jsm_request_commented'),
  }),

  outputs: buildJsmCommentOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
