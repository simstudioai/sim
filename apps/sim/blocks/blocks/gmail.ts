import { GmailIcon } from '@/components/icons'
import type { GmailToolResponse } from '@/tools/gmail/types'
import type { BlockConfig } from '../types'

export const GmailBlock: BlockConfig<GmailToolResponse> = {
  type: 'gmail',
  name: 'Gmail',
  description: 'Send Gmail',
  longDescription:
    'Integrate Gmail functionality to send email messages within your workflow. Automate email communications and process email content using OAuth authentication.',
  docsLink: 'https://docs.simstudio.ai/tools/gmail',
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
        // 'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.labels',
      ],
      placeholder: 'Select Gmail account',
    },
    // Send Email Fields
    {
      id: 'to',
      title: 'To',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Recipient email address',
      condition: { field: 'operation', value: ['send_gmail', 'draft_gmail'] },
    },
    {
      id: 'subject',
      title: 'Subject',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Email subject',
      condition: { field: 'operation', value: ['send_gmail', 'draft_gmail'] },
    },
    {
      id: 'body',
      title: 'Body',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Email content',
      condition: { field: 'operation', value: ['send_gmail', 'draft_gmail'] },
    },
    // Read Email Fields - Add folder selector
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
        const { credential, ...rest } = params

        // Ensure folder is always provided for read_gmail operation
        if (rest.operation === 'read_gmail') {
          rest.folder = rest.folder || 'INBOX'
        }

        return {
          ...rest,
          credential,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    credential: { type: 'string', required: true },
    // Send operation inputs
    to: { type: 'string', required: false },
    subject: { type: 'string', required: false },
    body: { type: 'string', required: false },
    // Read operation inputs
    folder: { type: 'string', required: false },
    messageId: { type: 'string', required: false },
    unreadOnly: { type: 'boolean', required: false },
    // Search operation inputs
    query: { type: 'string', required: false },
    maxResults: { type: 'number', required: false },
  },
  outputs: {
    content: 'string',
    metadata: 'json',
  },
}
