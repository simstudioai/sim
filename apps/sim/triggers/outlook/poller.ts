import { OutlookIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'

export const outlookPollingTrigger: TriggerConfig = {
  id: 'outlook_poller',
  name: 'Outlook Email Trigger',
  provider: 'outlook',
  description: 'Triggers when new emails are received in Outlook (requires Microsoft credentials)',
  version: '1.0.0',
  icon: OutlookIcon,

  // Outlook requires OAuth credentials to work
  requiresCredentials: true,
  credentialProvider: 'outlook',

  configFields: {
    folderIds: {
      type: 'multiselect',
      label: 'Outlook Folders to Monitor',
      placeholder: 'Select Outlook folders to monitor for new emails',
      description: 'Choose which Outlook folders to monitor. Leave empty to monitor all emails.',
      required: false,
      options: [], // Will be populated dynamically from user's Outlook folders
    },
    folderFilterBehavior: {
      type: 'select',
      label: 'Folder Filter Behavior',
      options: ['INCLUDE', 'EXCLUDE'],
      defaultValue: 'INCLUDE',
      description:
        'Include only emails from selected folders, or exclude emails from selected folders',
      required: true,
    },
    markAsRead: {
      type: 'boolean',
      label: 'Mark as Read',
      defaultValue: false,
      description: 'Automatically mark emails as read after processing',
      required: false,
    },
    includeRawEmail: {
      type: 'boolean',
      label: 'Include Raw Email Data',
      defaultValue: false,
      description: 'Include the complete raw Microsoft Graph API response in the trigger payload',
      required: false,
    },
  },

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
        description: 'Plain text email body (preview)',
      },
      bodyHtml: {
        type: 'string',
        description: 'HTML email body',
      },
      hasAttachments: {
        type: 'boolean',
        description: 'Whether email has attachments',
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
    rawEmail: {
      type: 'json',
      description: 'Complete raw email data from Microsoft Graph API (if enabled)',
    },
  },

  instructions: [
    'Connect your Microsoft account using OAuth credentials',
    'Configure which Outlook folders to monitor (optional)',
    'The system will automatically check for new emails and trigger your workflow',
  ],

  samplePayload: {
    email: {
      id: 'AAMkADg1OWUyZjg4LWJkNGYtNDFhYy04OGVjLWVkM2VhY2YzYTcwZgBGAAAAAACE3bU',
      conversationId: 'AAQkADg1OWUyZjg4LWJkNGYtNDFhYy04OGVjLWVkM2VhY2YzYTcwZgAQAErzGBJV',
      subject: 'Quarterly Business Review - Q1 2025',
      from: 'manager@company.com',
      to: 'team@company.com',
      cc: 'stakeholders@company.com',
      date: '2025-05-10T14:30:00Z',
      bodyText:
        'Hi Team,\n\nPlease find attached the Q1 2025 business review document. We need to discuss the results in our next meeting.\n\nBest regards,\nManager',
      bodyHtml:
        '<div><p>Hi Team,</p><p>Please find attached the Q1 2025 business review document. We need to discuss the results in our next meeting.</p><p>Best regards,<br>Manager</p></div>',
      hasAttachments: true,
      isRead: false,
      folderId: 'AQMkADg1OWUyZjg4LWJkNGYtNDFhYy04OGVjAC4AAAJzE3bU',
      messageId: 'AAMkADg1OWUyZjg4LWJkNGYtNDFhYy04OGVjLWVkM2VhY2YzYTcwZgBGAAAAAACE3bU',
      threadId: 'AAQkADg1OWUyZjg4LWJkNGYtNDFhYy04OGVjLWVkM2VhY2YzYTcwZgAQAErzGBJV',
    },
    timestamp: '2025-05-10T14:30:15.123Z',
  },
}
