import { JiraServiceManagementIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildJsmExtraFields,
  buildJsmRequestOutputs,
  jsmSetupInstructions,
  jsmTriggerOptions,
} from '@/triggers/jsm/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * JSM Request Created Trigger
 *
 * Primary trigger — includes the dropdown for selecting trigger type.
 * Triggers when a new service request is created in Jira Service Management.
 */
export const jsmRequestCreatedTrigger: TriggerConfig = {
  id: 'jsm_request_created',
  name: 'JSM Request Created',
  provider: 'jsm',
  description: 'Trigger workflow when a new service request is created in Jira Service Management',
  version: '1.0.0',
  icon: JiraServiceManagementIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'jsm_request_created',
    triggerOptions: jsmTriggerOptions,
    includeDropdown: true,
    setupInstructions: jsmSetupInstructions('jira:issue_created'),
    extraFields: buildJsmExtraFields('jsm_request_created'),
  }),

  outputs: buildJsmRequestOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
