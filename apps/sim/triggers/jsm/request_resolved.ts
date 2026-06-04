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
 * JSM Request Resolved Trigger
 *
 * Triggers when a service request is resolved (status changed to Resolved, Done, or Closed).
 * This is a specialized issue_updated event filtered by changelog status changes.
 */
export const jsmRequestResolvedTrigger: TriggerConfig = {
  id: 'jsm_request_resolved',
  name: 'JSM Request Resolved',
  provider: 'jsm',
  description: 'Trigger workflow when a service request is resolved in Jira Service Management',
  version: '1.0.0',
  icon: JiraServiceManagementIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'jsm_request_resolved',
    triggerOptions: jsmTriggerOptions,
    setupInstructions: jsmSetupInstructions(
      'jira:issue_updated',
      'This trigger fires when a request status changes to Resolved, Done, or Closed.'
    ),
    extraFields: buildJsmExtraFields('jsm_request_resolved'),
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
