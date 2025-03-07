import { GmailIcon } from '@/components/icons'
import { GmailToolResponse } from '@/tools/gmail/types'
import { BlockConfig } from '../types'

export const GmailBlock: BlockConfig<GmailToolResponse> = {
  type: 'gmail',
  name: 'Gmail',
  description: 'Send, read, and search Gmail messages',
  longDescription:
    'Integrate Gmail functionality to send, read, and search email messages within your workflow. Automate email communications and process email content using OAuth authentication.',
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
        { label: 'Search Emails', id: 'search_gmail' },
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
        'https://www.googleapis.com/auth/gmail.readonly',
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
      condition: { field: 'operation', value: 'send_gmail' },
    },
    {
      id: 'subject',
      title: 'Subject',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Email subject',
      condition: { field: 'operation', value: 'send_gmail' },
    },
    {
      id: 'body',
      title: 'Body',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Email content',
      condition: { field: 'operation', value: 'send_gmail' },
    },
    // Read Email Fields
    {
      id: 'messageId',
      title: 'Message ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter message ID to read',
      condition: { field: 'operation', value: 'read_gmail' },
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
      condition: { field: 'operation', value: 'search_gmail' },
    },
  ],
  tools: {
    access: ['gmail_send', 'gmail_read', 'gmail_search'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'send_gmail':
            return 'gmail_send'
          case 'read_gmail':
            return 'gmail_read'
          case 'search_gmail':
            return 'gmail_search'
          default:
            throw new Error(`Invalid Gmail operation: ${params.operation}`)
        }
      },
      params: (params) => {
        // Pass the credential directly from the credential field
        const { credential, ...rest } = params
        return {
          ...rest,
          credential, // Keep the credential parameter
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
    messageId: { type: 'string', required: false },
    // Search operation inputs
    query: { type: 'string', required: false },
    maxResults: { type: 'number', required: false },
  },
  outputs: {
    response: {
      type: {
        content: 'string',
        metadata: 'json',
      },
    },
  },
}
