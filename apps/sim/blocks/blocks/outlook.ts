import { OutlookIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { OutlookResponse } from '@/tools/outlook/types'

export const OutlookBlock: BlockConfig<OutlookResponse> = {
  type: 'outlook',
  name: 'Outlook',
  description: 'Access Outlook',
  longDescription:
    'Integrate Outlook functionality to read, draft, andsend email messages within your workflow. Automate email communications and process email content using OAuth authentication.',
  docsLink: 'https://docs.sim.ai/tools/outlook',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: OutlookIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Send Email', id: 'send_outlook' },
        { label: 'Draft Email', id: 'draft_outlook' },
        { label: 'Read Email', id: 'read_outlook' },
      ],
      value: () => 'send_outlook',
    },
    {
      id: 'credential',
      title: 'Microsoft Account',
      type: 'oauth-input',
      layout: 'full',
      provider: 'outlook',
      serviceId: 'outlook',
      requiredScopes: [
        'Mail.ReadWrite',
        'Mail.ReadBasic',
        'Mail.Read',
        'Mail.Send',
        'offline_access',
        'openid',
        'profile',
        'email',
      ],
      placeholder: 'Select Microsoft account',
      required: true,
    },
    {
      id: 'to',
      title: 'To',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Recipient email address',
      condition: { field: 'operation', value: ['send_outlook', 'draft_outlook'] },
      required: true,
    },
    {
      id: 'subject',
      title: 'Subject',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Email subject',
      condition: { field: 'operation', value: ['send_outlook', 'draft_outlook'] },
      required: true,
    },
    {
      id: 'body',
      title: 'Body',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Email content',
      condition: { field: 'operation', value: ['send_outlook', 'draft_outlook'] },
      required: true,
    },
    // Advanced Settings - Threading
    {
      id: 'replyToMessageId',
      title: 'Reply to Message ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Message ID to reply to (for threading)',
      condition: { field: 'operation', value: ['send_outlook'] },
      mode: 'advanced',
      required: false,
    },
    {
      id: 'conversationId',
      title: 'Conversation ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Conversation ID for threading',
      condition: { field: 'operation', value: ['send_outlook'] },
      mode: 'advanced',
      required: false,
    },
    // Advanced Settings - Additional Recipients
    {
      id: 'cc',
      title: 'CC',
      type: 'short-input',
      layout: 'full',
      placeholder: 'CC recipients (comma-separated)',
      condition: { field: 'operation', value: ['send_outlook', 'draft_outlook'] },
      mode: 'advanced',
      required: false,
    },
    {
      id: 'bcc',
      title: 'BCC',
      type: 'short-input',
      layout: 'full',
      placeholder: 'BCC recipients (comma-separated)',
      condition: { field: 'operation', value: ['send_outlook', 'draft_outlook'] },
      mode: 'advanced',
      required: false,
    },
    // Read Email Fields - Add folder selector (basic mode)
    {
      id: 'folder',
      title: 'Folder',
      type: 'folder-selector',
      layout: 'full',
      provider: 'outlook',
      serviceId: 'outlook',
      requiredScopes: ['Mail.ReadWrite', 'Mail.ReadBasic', 'Mail.Read'],
      placeholder: 'Select Outlook folder',
      mode: 'basic',
      condition: { field: 'operation', value: 'read_outlook' },
    },
    // Manual folder input (advanced mode)
    {
      id: 'manualFolder',
      title: 'Folder',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter Outlook folder name (e.g., INBOX, SENT, or custom folder)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'read_outlook' },
    },
    {
      id: 'maxResults',
      title: 'Number of Emails',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Number of emails to retrieve (default: 1, max: 10)',
      condition: { field: 'operation', value: 'read_outlook' },
    },
  ],
  tools: {
    access: ['outlook_send', 'outlook_draft', 'outlook_read'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'send_outlook':
            return 'outlook_send'
          case 'read_outlook':
            return 'outlook_read'
          case 'draft_outlook':
            return 'outlook_draft'
          default:
            throw new Error(`Invalid Outlook operation: ${params.operation}`)
        }
      },
      params: (params) => {
        // Pass the credential directly from the credential field
        const { credential, folder, manualFolder, ...rest } = params

        // Handle folder input (selector or manual)
        const effectiveFolder = (folder || manualFolder || '').trim()

        // Set default folder to INBOX if not specified
        if (rest.operation === 'read_outlook') {
          rest.folder = effectiveFolder || 'INBOX'
        }

        return {
          ...rest,
          credential, // Keep the credential parameter
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Outlook access token' },
    // Send operation inputs
    to: { type: 'string', description: 'Recipient email address' },
    subject: { type: 'string', description: 'Email subject' },
    body: { type: 'string', description: 'Email content' },
    // Read operation inputs
    folder: { type: 'string', description: 'Email folder' },
    manualFolder: { type: 'string', description: 'Manual folder name' },
    maxResults: { type: 'number', description: 'Maximum emails' },
  },
  outputs: {
    message: { type: 'string', description: 'Response message' },
    results: { type: 'json', description: 'Email results' },
  },
}
