import { createLogger } from '@sim/logger'
import { MailServerIcon } from '@/components/icons'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import type { TriggerConfig } from '@/triggers/types'

const logger = createLogger('ImapPollingTrigger')

export const imapPollingTrigger: TriggerConfig = {
  id: 'imap_poller',
  name: 'IMAP Email Trigger',
  provider: 'imap',
  description: 'Triggers when new emails are received via IMAP (works with any email provider)',
  version: '1.0.0',
  icon: MailServerIcon,

  subBlocks: [
    // Connection settings
    {
      id: 'host',
      title: 'IMAP Server',
      type: 'short-input',
      placeholder: 'imap.example.com',
      description: 'IMAP server hostname (e.g., imap.gmail.com, outlook.office365.com)',
      required: true,
      mode: 'trigger',
    },
    {
      id: 'port',
      title: 'Port',
      type: 'short-input',
      placeholder: '993',
      description: 'IMAP port (993 for SSL/TLS, 143 for STARTTLS)',
      defaultValue: '993',
      required: true,
      mode: 'trigger',
    },
    {
      id: 'secure',
      title: 'Use SSL/TLS',
      type: 'switch',
      defaultValue: true,
      description: 'Enable SSL/TLS encryption (recommended for port 993)',
      required: false,
      mode: 'trigger',
    },
    {
      id: 'rejectUnauthorized',
      title: 'Verify TLS Certificate',
      type: 'switch',
      defaultValue: true,
      description: 'Verify server TLS certificate. Disable for self-signed certificates.',
      required: false,
      mode: 'trigger',
    },
    // Authentication
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'user@example.com',
      description: 'Email address or username for authentication',
      required: true,
      mode: 'trigger',
    },
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      password: true,
      placeholder: 'App password or email password',
      description: 'Password or app-specific password (for Gmail, use an App Password)',
      required: true,
      mode: 'trigger',
    },
    // Mailbox selection
    {
      id: 'mailbox',
      title: 'Mailboxes to Monitor',
      type: 'dropdown',
      multiSelect: true,
      placeholder: 'Select mailboxes to monitor',
      description:
        'Choose which mailbox/folder(s) to monitor for new emails. Leave empty to monitor INBOX.',
      required: false,
      options: [],
      fetchOptions: async (blockId: string, _subBlockId: string) => {
        const store = useSubBlockStore.getState()
        const host = store.getValue(blockId, 'host') as string | null
        const port = store.getValue(blockId, 'port') as string | null
        const secure = store.getValue(blockId, 'secure') as boolean | null
        const rejectUnauthorized = store.getValue(blockId, 'rejectUnauthorized') as boolean | null
        const username = store.getValue(blockId, 'username') as string | null
        const password = store.getValue(blockId, 'password') as string | null

        if (!host || !username || !password) {
          throw new Error('Please enter IMAP server, username, and password first')
        }

        try {
          const response = await fetch('/api/tools/imap/mailboxes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              host,
              port: port ? Number.parseInt(port, 10) : 993,
              secure: secure ?? true,
              rejectUnauthorized: rejectUnauthorized ?? true,
              username,
              password,
            }),
          })

          if (!response.ok) {
            const error = await response.json()
            throw new Error(error.message || 'Failed to fetch mailboxes')
          }

          const data = await response.json()
          if (data.mailboxes && Array.isArray(data.mailboxes)) {
            return data.mailboxes.map((mailbox: { path: string; name: string }) => ({
              id: mailbox.path,
              label: mailbox.name,
            }))
          }
          return []
        } catch (error) {
          logger.error('Error fetching IMAP mailboxes:', error)
          throw error
        }
      },
      dependsOn: ['host', 'port', 'secure', 'rejectUnauthorized', 'username', 'password'],
      mode: 'trigger',
    },
    // Email filtering
    {
      id: 'searchCriteria',
      title: 'Search Criteria',
      type: 'short-input',
      placeholder: 'UNSEEN',
      description:
        'IMAP search criteria (e.g., UNSEEN, FROM "sender@example.com", SUBJECT "report"). Default: UNSEEN',
      defaultValue: 'UNSEEN',
      required: false,
      mode: 'trigger',
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert in IMAP search syntax (RFC 3501). Generate IMAP search criteria based on user descriptions.

IMAP search keys include:
- ALL - All messages
- UNSEEN / SEEN - Unread/read messages
- FLAGGED / UNFLAGGED - Starred/unstarred
- FROM "string" - Sender contains string
- TO "string" - Recipient contains string
- SUBJECT "string" - Subject contains string
- BODY "string" - Body contains string
- TEXT "string" - Headers or body contains string
- BEFORE date / SINCE date / ON date - Date filters (DD-Mon-YYYY, e.g., 01-Jan-2024)
- LARGER n / SMALLER n - Size in bytes
- HEADER field-name "string" - Custom header search
- NOT criteria - Negate
- OR criteria1 criteria2 - Either matches
- (criteria) - Grouping

Multiple criteria are AND'd together by default.

Examples:
- UNSEEN FROM "boss@company.com"
- OR FROM "alice" FROM "bob"
- SINCE 01-Jan-2024 SUBJECT "report"
- NOT SEEN FLAGGED

Current criteria: {context}

Return ONLY the IMAP search criteria, no explanations or markdown.`,
        placeholder: 'Describe what emails you want to filter...',
      },
    },
    // Processing options
    {
      id: 'markAsRead',
      title: 'Mark as Read',
      type: 'switch',
      defaultValue: true,
      description: 'Automatically mark emails as read (SEEN) after processing',
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
    // Instructions
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        'Enter your IMAP server details (host, port, SSL settings)',
        'Enter your email credentials (username and password)',
        'For Gmail: Use an <a href="https://support.google.com/accounts/answer/185833" target="_blank">App Password</a> instead of your regular password',
        'Select the mailbox to monitor (INBOX is most common)',
        'Optionally configure search criteria and processing options',
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
      triggerId: 'imap_poller',
    },
  ],

  outputs: {
    email: {
      messageId: {
        type: 'string',
        description: 'RFC Message-ID header',
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
      mailbox: {
        type: 'string',
        description: 'Mailbox/folder where email was received',
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
