import { OutlookIcon } from '@/components/icons'
import { createLogger } from '@/lib/logs/console/logger'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import type { TriggerConfig } from '@/triggers/types'

const logger = createLogger('OutlookPollingTrigger')

export const outlookPollingTrigger: TriggerConfig = {
  id: 'outlook_poller',
  name: 'Outlook Email Trigger',
  provider: 'outlook',
  description: 'Triggers when new emails are received in Outlook (requires Microsoft credentials)',
  version: '1.0.0',
  icon: OutlookIcon,

  subBlocks: [
    {
      id: 'triggerCredentials',
      title: 'Credentials',
      type: 'oauth-input',
      description: 'This trigger requires outlook credentials to access your account.',
      provider: 'outlook',
      requiredScopes: [],
      required: true,
      mode: 'trigger',
    },
    {
      id: 'folderIds',
      title: 'Outlook Folders to Monitor',
      type: 'dropdown',
      multiSelect: true,
      placeholder: 'Select Outlook folders to monitor for new emails',
      description: 'Choose which Outlook folders to monitor. Leave empty to monitor all emails.',
      required: false,
      options: [], // Will be populated dynamically
      fetchOptions: async (blockId: string, subBlockId: string) => {
        const credentialId = useSubBlockStore.getState().getValue(blockId, 'triggerCredentials') as
          | string
          | null
        if (!credentialId) {
          throw new Error('No Outlook credential selected')
        }
        try {
          const response = await fetch(`/api/tools/outlook/folders?credentialId=${credentialId}`)
          if (!response.ok) {
            throw new Error('Failed to fetch Outlook folders')
          }
          const data = await response.json()
          if (data.folders && Array.isArray(data.folders)) {
            return data.folders.map((folder: { id: string; name: string }) => ({
              id: folder.id,
              label: folder.name,
            }))
          }
          return []
        } catch (error) {
          logger.error('Error fetching Outlook folders:', error)
          throw error
        }
      },
      dependsOn: ['triggerCredentials'],
      mode: 'trigger',
    },
    {
      id: 'folderFilterBehavior',
      title: 'Folder Filter Behavior',
      type: 'dropdown',
      options: [
        { label: 'INCLUDE', id: 'INCLUDE' },
        { label: 'EXCLUDE', id: 'EXCLUDE' },
      ],
      defaultValue: 'INCLUDE',
      description:
        'Include only emails from selected folders, or exclude emails from selected folders',
      required: true,
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
        'Connect your Microsoft account using OAuth credentials',
        'Configure which Outlook folders to monitor (optional)',
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
      triggerId: 'outlook_poller',
    },
  ],

  outputs: {
    email: {
      id: {
        type: 'string',
        description: 'Outlook message ID',
      },
      conversationId: {
        type: 'string',
        description: 'Outlook conversation ID',
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
      hasAttachments: {
        type: 'boolean',
        description: 'Whether email has attachments',
      },
      attachments: {
        type: 'file[]',
        description: 'Array of email attachments as files (if includeAttachments is enabled)',
      },
      isRead: {
        type: 'boolean',
        description: 'Whether email is read',
      },
      folderId: {
        type: 'string',
        description: 'Outlook folder ID where email is located',
      },
      messageId: {
        type: 'string',
        description: 'Message ID for threading',
      },
      threadId: {
        type: 'string',
        description: 'Thread ID for conversation threading',
      },
    },
    timestamp: {
      type: 'string',
      description: 'Event timestamp',
    },
  },
}
