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
    },
    {
      id: 'to',
      title: 'To',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Recipient email address',
      condition: { field: 'operation', value: ['send_outlook', 'draft_outlook'] },
    },
    {
      id: 'subject',
      title: 'Subject',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Email subject',
      condition: { field: 'operation', value: ['send_outlook', 'draft_outlook'] },
    },
    {
      id: 'body',
      title: 'Body',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Email content',
      condition: { field: 'operation', value: ['send_outlook', 'draft_outlook'] },
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
    operation: { type: 'string', required: true },
    credential: { type: 'string', required: true },
    // Send operation inputs
    to: { type: 'string', required: false },
    subject: { type: 'string', required: false },
    body: { type: 'string', required: false },
    // Read operation inputs
    folder: { type: 'string', required: false },
    manualFolder: { type: 'string', required: false },
    maxResults: { type: 'number', required: false },
  },
  outputs: {
    message: 'string',
    results: 'json',
  },
}
