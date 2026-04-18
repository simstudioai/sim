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
 * Generic JSM Webhook Trigger
 *
 * Captures all Jira Service Management webhook events.
 */
export const jsmWebhookTrigger: TriggerConfig = {
  id: 'jsm_webhook',
  name: 'JSM Webhook (All Events)',
  provider: 'jsm',
  description: 'Trigger workflow on any Jira Service Management webhook event',
  version: '1.0.0',
  icon: JiraServiceManagementIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'jsm_webhook',
    triggerOptions: jsmTriggerOptions,
    setupInstructions: jsmSetupInstructions('All Events'),
    extraFields: buildJsmExtraFields('jsm_webhook'),
  }),

  outputs: {
    ...buildJsmRequestOutputs(),
    changelog: {
      id: {
        type: 'string',
        description: 'Changelog ID',
      },
      items: {
        type: 'array',
        description:
          'Array of changed items. Each item contains field, fieldtype, from, fromString, to, toString',
      },
    },
    comment: {
      id: {
        type: 'string',
        description: 'Comment ID',
      },
      body: {
        type: 'json',
        description:
          'Comment body in Atlassian Document Format (ADF). On Jira Server this may be a plain string.',
      },
      author: {
        displayName: {
          type: 'string',
          description: 'Comment author display name',
        },
        accountId: {
          type: 'string',
          description: 'Comment author account ID',
        },
        emailAddress: {
          type: 'string',
          description: 'Comment author email address',
        },
      },
      created: {
        type: 'string',
        description: 'Comment creation date (ISO format)',
      },
      updated: {
        type: 'string',
        description: 'Comment last updated date (ISO format)',
      },
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature': 'sha256=...',
      'X-Atlassian-Webhook-Identifier': 'unique-webhook-id',
    },
  },
}
