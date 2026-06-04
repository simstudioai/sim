import { JiraServiceManagementIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildJsmExtraFields,
  buildJsmRequestUpdatedOutputs,
  jsmSetupInstructions,
  jsmTriggerOptions,
} from '@/triggers/jsm/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * JSM Request Updated Trigger
 *
 * Triggers when a service request is updated in Jira Service Management.
 */
export const jsmRequestUpdatedTrigger: TriggerConfig = {
  id: 'jsm_request_updated',
  name: 'JSM Request Updated',
  provider: 'jsm',
  description: 'Trigger workflow when a service request is updated in Jira Service Management',
  version: '1.0.0',
  icon: JiraServiceManagementIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'jsm_request_updated',
    triggerOptions: jsmTriggerOptions,
    setupInstructions: jsmSetupInstructions('jira:issue_updated'),
    extraFields: buildJsmExtraFields('jsm_request_updated'),
  }),

  outputs: buildJsmRequestUpdatedOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
