import { GmailIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'

export const gmailPollingTrigger: TriggerConfig = {
  id: 'gmail_poller',
  name: 'Gmail Email Trigger',
  provider: 'gmail',
  description: 'Triggers when new emails are received in Gmail (requires Gmail credentials)',
  version: '1.0.0',
  icon: GmailIcon,

  // Gmail requires OAuth credentials to work
  requiresCredentials: true,
  credentialProvider: 'google-email',

  configFields: {
    labelIds: {
      type: 'multiselect',
      label: 'Gmail Labels to Monitor',
      placeholder: 'Select Gmail labels to monitor for new emails',
      description: 'Choose which Gmail labels to monitor. Leave empty to monitor all emails.',
      required: false,
      options: [], // Will be populated dynamically from user's Gmail labels
    },
    labelFilterBehavior: {
      type: 'select',
      label: 'Label Filter Behavior',
      options: ['INCLUDE', 'EXCLUDE'],
      defaultValue: 'INCLUDE',
      description:
        'Include only emails with selected labels, or exclude emails with selected labels',
      required: true,
    },
    searchQuery: {
      type: 'string',
      label: 'Gmail Search Query',
      placeholder: 'subject:report OR from:important@example.com',
      description:
        'Optional Gmail search query to filter emails. Use the same format as Gmail search box (e.g., "subject:invoice", "from:boss@company.com", "has:attachment"). Leave empty to search all emails.',
      required: false,
    },
    markAsRead: {
      type: 'boolean',
      label: 'Mark as Read',
      defaultValue: false,
      description: 'Automatically mark emails as read after processing',
      required: false,
    },
    includeAttachments: {
      type: 'boolean',
      label: 'Include Attachments',
      defaultValue: false,
      description: 'Download and include email attachments in the trigger payload',
      required: false,
    },
  },

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

  instructions: [
    'Connect your Gmail account using OAuth credentials',
    'Configure which Gmail labels to monitor (optional)',
    'The system will automatically check for new emails and trigger your workflow',
  ],

  samplePayload: {
    email: {
      id: '18e0ffabd5b5a0f4',
      threadId: '18e0ffabd5b5a0f4',
      subject: 'Monthly Report - April 2025',
      from: 'sender@example.com',
      to: 'recipient@example.com',
      cc: 'team@example.com',
      date: '2025-05-10T10:15:23.000Z',
      bodyText:
        'Hello,\n\nPlease find attached the monthly report for April 2025.\n\nBest regards,\nSender',
      bodyHtml:
        '<div><p>Hello,</p><p>Please find attached the monthly report for April 2025.</p><p>Best regards,<br>Sender</p></div>',
      labels: ['INBOX', 'IMPORTANT'],
      hasAttachments: true,
      attachments: [],
    },
    timestamp: '2025-05-10T10:15:30.123Z',
  },
}
