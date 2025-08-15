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
      description: 'Include the complete raw Gmail API response in the trigger payload',
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
        type: 'json',
        description: 'Array of attachment information',
      },
    },
    timestamp: {
      type: 'string',
      description: 'Event timestamp',
    },
    rawEmail: {
      type: 'json',
      description: 'Complete raw email data from Gmail API (if enabled)',
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
      attachments: [
        {
          filename: 'report-april-2025.pdf',
          mimeType: 'application/pdf',
          size: 2048576,
        },
      ],
    },
    timestamp: '2025-05-10T10:15:30.123Z',
  },
}
