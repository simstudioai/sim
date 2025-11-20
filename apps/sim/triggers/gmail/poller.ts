import { GmailIcon } from '@/components/icons'
import { createLogger } from '@/lib/logs/console/logger'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import type { TriggerConfig } from '@/triggers/types'

const logger = createLogger('GmailPollingTrigger')

export const gmailPollingTrigger: TriggerConfig = {
  id: 'gmail_poller',
  name: 'Gmail Email Trigger',
  provider: 'gmail',
  description: 'Triggers when new emails are received in Gmail (requires Gmail credentials)',
  version: '1.0.0',
  icon: GmailIcon,

  subBlocks: [
    {
      id: 'triggerCredentials',
      title: 'Credentials',
      type: 'oauth-input',
      description: 'This trigger requires google email credentials to access your account.',
      provider: 'google-email',
      requiredScopes: [],
      required: true,
      mode: 'trigger',
    },
    {
      id: 'labelIds',
      title: 'Gmail Labels to Monitor',
      type: 'dropdown',
      multiSelect: true,
      placeholder: 'Select Gmail labels to monitor for new emails',
      description: 'Choose which Gmail labels to monitor. Leave empty to monitor all emails.',
      required: false,
      options: [], // Will be populated dynamically from user's Gmail labels
      fetchOptions: async (blockId: string, subBlockId: string) => {
        const credentialId = useSubBlockStore.getState().getValue(blockId, 'triggerCredentials') as
          | string
          | null
        if (!credentialId) {
          // Return a sentinel to prevent infinite retry loops when credential is missing
          throw new Error('No Gmail credential selected')
        }
        try {
          const response = await fetch(`/api/tools/gmail/labels?credentialId=${credentialId}`)
          if (!response.ok) {
            throw new Error('Failed to fetch Gmail labels')
          }
          const data = await response.json()
          if (data.labels && Array.isArray(data.labels)) {
            return data.labels.map((label: { id: string; name: string }) => ({
              id: label.id,
              label: label.name,
            }))
          }
          return []
        } catch (error) {
          logger.error('Error fetching Gmail labels:', error)
          throw error
        }
      },
      dependsOn: ['triggerCredentials'],
      mode: 'trigger',
    },
    {
      id: 'labelFilterBehavior',
      title: 'Label Filter Behavior',
      type: 'dropdown',
      options: [
        { label: 'INCLUDE', id: 'INCLUDE' },
        { label: 'EXCLUDE', id: 'EXCLUDE' },
      ],
      defaultValue: 'INCLUDE',
      description:
        'Include only emails with selected labels, or exclude emails with selected labels',
      required: true,
      mode: 'trigger',
    },
    {
      id: 'searchQuery',
      title: 'Gmail Search Query',
      type: 'short-input',
      placeholder: 'subject:report OR from:important@example.com',
      description:
        'Optional Gmail search query to filter emails. Use the same format as Gmail search box (e.g., "subject:invoice", "from:boss@company.com", "has:attachment"). Leave empty to search all emails.',
      required: false,
      mode: 'trigger',
    },
    {
      id: 'markAsRead',
      title: 'Mark as Read',
      type: 'switch',
      defaultValue: false,
      description: 'Automatically mark emails as read after processing',
      required: false,
      mode: 'trigger',
    },
    {
      id: 'includeAttachments',
      title: 'Include Attachments',
      type: 'switch',
      defaultValue: false,
      description: 'Download and include email attachments in the trigger payload',
      required: false,
      mode: 'trigger',
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        'Connect your Gmail account using OAuth credentials',
        'Configure which Gmail labels to monitor (optional)',
        'The system will automatically check for new emails and trigger your workflow',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
    },
    {
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'gmail_poller',
    },
  ],

  outputs: {
    email: {
      id: {
        type: 'string',
        description: 'Gmail message ID',
      },
      threadId: {
        type: 'string',
        description: 'Gmail thread ID',
      },
      subject: {
        type: 'string',
        description: 'Email subject line',
      },
      from: {
        type: 'string',
        description: 'Sender email address',
      },
      to: {
        type: 'string',
        description: 'Recipient email address',
      },
      cc: {
        type: 'string',
        description: 'CC recipients',
      },
      date: {
        type: 'string',
        description: 'Email date in ISO format',
      },
      bodyText: {
        type: 'string',
        description: 'Plain text email body',
      },
      bodyHtml: {
        type: 'string',
        description: 'HTML email body',
      },
      labels: {
        type: 'string',
        description: 'Email labels array',
      },
      hasAttachments: {
        type: 'boolean',
        description: 'Whether email has attachments',
      },
      attachments: {
        type: 'file[]',
        description: 'Array of email attachments as files (if includeAttachments is enabled)',
      },
    },
    timestamp: {
      type: 'string',
      description: 'Event timestamp',
    },
  },
}
