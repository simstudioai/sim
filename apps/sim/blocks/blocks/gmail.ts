import { GmailIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { GmailToolResponse } from '@/tools/gmail/types'

export const GmailBlock: BlockConfig<GmailToolResponse> = {
  type: 'gmail',
  name: 'Gmail',
  description: 'Send Gmail',
  longDescription:
    'Integrate Gmail functionality to send email messages within your workflow. Automate email communications and process email content using OAuth authentication.',
  docsLink: 'https://docs.sim.ai/tools/gmail',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: GmailIcon,
  subBlocks: [
    // Operation selector
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Send Email', id: 'send_gmail' },
        { label: 'Read Email', id: 'read_gmail' },
        { label: 'Draft Email', id: 'draft_gmail' },
        { label: 'Search Email', id: 'search_gmail' },
      ],
      value: () => 'send_gmail',
    },
    // Gmail Credentials
    {
      id: 'credential',
      title: 'Gmail Account',
      type: 'oauth-input',
      layout: 'full',
      provider: 'google-email',
      serviceId: 'gmail',
      requiredScopes: [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.labels',
      ],
      placeholder: 'Select Gmail account',
      required: true,
    },
    // Send Email Fields
    {
      id: 'to',
      title: 'To',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Recipient email address',
      condition: { field: 'operation', value: ['send_gmail', 'draft_gmail'] },
      required: true,
    },
    {
      id: 'subject',
      title: 'Subject',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Email subject',
      condition: { field: 'operation', value: ['send_gmail', 'draft_gmail'] },
      required: true,
    },
    {
      id: 'body',
      title: 'Body',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Email content',
      condition: { field: 'operation', value: ['send_gmail', 'draft_gmail'] },
      required: true,
    },
    // Label/folder selector (basic mode)
    {
      id: 'folder',
      title: 'Label',
      type: 'folder-selector',
      layout: 'full',
      provider: 'google-email',
      serviceId: 'gmail',
      requiredScopes: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.labels',
      ],
      placeholder: 'Select Gmail label/folder',
      mode: 'basic',
      condition: { field: 'operation', value: 'read_gmail' },
    },
    // Manual label/folder input (advanced mode)
    {
      id: 'manualFolder',
      title: 'Label/Folder',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Gmail label name (e.g., INBOX, SENT, or custom label)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'read_gmail' },
    },
    {
      id: 'unreadOnly',
      title: 'Unread Only',
      type: 'switch',
      layout: 'full',
      condition: { field: 'operation', value: 'read_gmail' },
    },
    {
      id: 'includeAttachments',
      title: 'Include Attachments',
      type: 'switch',
      layout: 'full',
      condition: { field: 'operation', value: 'read_gmail' },
    },
    {
      id: 'messageId',
      title: 'Message ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter message ID to read (optional)',
      condition: {
        field: 'operation',
        value: 'read_gmail',
        and: {
          field: 'folder',
          value: '',
        },
      },
    },
    // Search Fields
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter search terms',
      condition: { field: 'operation', value: 'search_gmail' },
      required: true,
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Maximum number of results (default: 10)',
      condition: { field: 'operation', value: ['search_gmail', 'read_gmail'] },
    },
  ],
  tools: {
    access: ['gmail_send', 'gmail_draft', 'gmail_read', 'gmail_search'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'send_gmail':
            return 'gmail_send'
          case 'draft_gmail':
            return 'gmail_draft'
          case 'search_gmail':
            return 'gmail_search'
          case 'read_gmail':
            return 'gmail_read'
          default:
            throw new Error(`Invalid Gmail operation: ${params.operation}`)
        }
      },
      params: (params) => {
        // Pass the credential directly from the credential field
        const { credential, folder, manualFolder, ...rest } = params

        // Handle folder input (selector or manual)
        const effectiveFolder = (folder || manualFolder || '').trim()

        // Ensure folder is always provided for read_gmail operation
        if (rest.operation === 'read_gmail') {
          rest.folder = effectiveFolder || 'INBOX'
        }

        return {
          ...rest,
          credential,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Gmail access token' },
    // Send operation inputs
    to: { type: 'string', description: 'Recipient email address' },
    subject: { type: 'string', description: 'Email subject' },
    body: { type: 'string', description: 'Email content' },
    // Read operation inputs
    folder: { type: 'string', description: 'Gmail folder' },
    manualFolder: { type: 'string', description: 'Manual folder name' },
    messageId: { type: 'string', description: 'Message identifier' },
    unreadOnly: { type: 'boolean', description: 'Unread messages only' },
    includeAttachments: { type: 'boolean', description: 'Include email attachments' },
    // Search operation inputs
    query: { type: 'string', description: 'Search query' },
    maxResults: { type: 'number', description: 'Maximum results' },
  },
  outputs: {
    content: { type: 'string', description: 'Response content' },
    metadata: { type: 'json', description: 'Email metadata' },
    attachments: {
      type: 'json',
      description: 'Email attachments (when includeAttachments is enabled)',
    },
  },
}
