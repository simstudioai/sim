import { GmailIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { GmailToolResponse } from '@/tools/gmail/types'
import { getTrigger } from '@/triggers'

export const GmailBlock: BlockConfig<GmailToolResponse> = {
  type: 'gmail',
  name: 'Gmail',
  description: 'Send, read, search, and move Gmail messages or trigger workflows from Gmail events',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Gmail into the workflow. Can send, read, search, and move emails. Can be used in trigger mode to trigger a workflow when a new email is received.',
  docsLink: 'https://docs.sim.ai/tools/gmail',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: GmailIcon,
  triggerAllowed: true,
  subBlocks: [
    // Operation selector
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Send Email', id: 'send_gmail' },
        { label: 'Read Email', id: 'read_gmail' },
        { label: 'Draft Email', id: 'draft_gmail' },
        { label: 'Search Email', id: 'search_gmail' },
        { label: 'Move Email', id: 'move_gmail' },
        { label: 'Mark as Read', id: 'mark_read_gmail' },
        { label: 'Mark as Unread', id: 'mark_unread_gmail' },
        { label: 'Archive Email', id: 'archive_gmail' },
        { label: 'Unarchive Email', id: 'unarchive_gmail' },
        { label: 'Delete Email', id: 'delete_gmail' },
        { label: 'Add Label', id: 'add_label_gmail' },
        { label: 'Remove Label', id: 'remove_label_gmail' },
      ],
      value: () => 'send_gmail',
    },
    // Gmail Credentials
    {
      id: 'credential',
      title: 'Gmail Account',
      type: 'oauth-input',
      provider: 'google-email',
      serviceId: 'gmail',
      requiredScopes: [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.modify',
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
      placeholder: 'Recipient email address',
      condition: { field: 'operation', value: ['send_gmail', 'draft_gmail'] },
      required: true,
    },
    {
      id: 'subject',
      title: 'Subject',
      type: 'short-input',
      placeholder: 'Email subject',
      condition: { field: 'operation', value: ['send_gmail', 'draft_gmail'] },
      required: false,
    },
    {
      id: 'body',
      title: 'Body',
      type: 'long-input',
      placeholder: 'Email content',
      condition: { field: 'operation', value: ['send_gmail', 'draft_gmail'] },
      required: true,
    },
    {
      id: 'contentType',
      title: 'Content Type',
      type: 'dropdown',
      options: [
        { label: 'Plain Text', id: 'text' },
        { label: 'HTML', id: 'html' },
      ],
      condition: { field: 'operation', value: ['send_gmail', 'draft_gmail'] },
      value: () => 'text',
      required: false,
    },
    // File upload (basic mode)
    {
      id: 'attachmentFiles',
      title: 'Attachments',
      type: 'file-upload',
      canonicalParamId: 'attachments',
      placeholder: 'Upload files to attach',
      condition: { field: 'operation', value: ['send_gmail', 'draft_gmail'] },
      mode: 'basic',
      multiple: true,
      required: false,
    },
    // Variable reference (advanced mode)
    {
      id: 'attachments',
      title: 'Attachments',
      type: 'short-input',
      canonicalParamId: 'attachments',
      placeholder: 'Reference files from previous blocks',
      condition: { field: 'operation', value: ['send_gmail', 'draft_gmail'] },
      mode: 'advanced',
      required: false,
    },
    // Advanced Settings - Threading
    {
      id: 'threadId',
      title: 'Thread ID',
      type: 'short-input',
      placeholder: 'Thread ID to reply to (for threading)',
      condition: { field: 'operation', value: ['send_gmail', 'draft_gmail'] },
      mode: 'advanced',
      required: false,
    },
    {
      id: 'replyToMessageId',
      title: 'Reply to Message ID',
      type: 'short-input',
      placeholder: 'Gmail message ID (not RFC Message-ID) - use the "id" field from results',
      condition: { field: 'operation', value: ['send_gmail', 'draft_gmail'] },
      mode: 'advanced',
      required: false,
    },
    // Advanced Settings - Additional Recipients
    {
      id: 'cc',
      title: 'CC',
      type: 'short-input',
      placeholder: 'CC recipients (comma-separated)',
      condition: { field: 'operation', value: ['send_gmail', 'draft_gmail'] },
      mode: 'advanced',
      required: false,
    },
    {
      id: 'bcc',
      title: 'BCC',
      type: 'short-input',
      placeholder: 'BCC recipients (comma-separated)',
      condition: { field: 'operation', value: ['send_gmail', 'draft_gmail'] },
      mode: 'advanced',
      required: false,
    },
    // Label/folder selector (basic mode)
    {
      id: 'folder',
      title: 'Label',
      type: 'folder-selector',
      canonicalParamId: 'folder',
      provider: 'google-email',
      serviceId: 'gmail',
      requiredScopes: ['https://www.googleapis.com/auth/gmail.labels'],
      placeholder: 'Select Gmail label/folder',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: 'read_gmail' },
    },
    // Manual label/folder input (advanced mode)
    {
      id: 'manualFolder',
      title: 'Label/Folder',
      type: 'short-input',
      canonicalParamId: 'folder',
      placeholder: 'Enter Gmail label name (e.g., INBOX, SENT, or custom label)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'read_gmail' },
    },
    {
      id: 'unreadOnly',
      title: 'Unread Only',
      type: 'switch',
      condition: { field: 'operation', value: 'read_gmail' },
    },
    {
      id: 'includeAttachments',
      title: 'Include Attachments',
      type: 'switch',
      condition: { field: 'operation', value: 'read_gmail' },
    },
    {
      id: 'messageId',
      title: 'Message ID',
      type: 'short-input',
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
      placeholder: 'Enter search terms',
      condition: { field: 'operation', value: 'search_gmail' },
      required: true,
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: 'Maximum number of results (default: 10)',
      condition: { field: 'operation', value: ['search_gmail', 'read_gmail'] },
    },
    // Move Email Fields
    {
      id: 'moveMessageId',
      title: 'Message ID',
      type: 'short-input',
      placeholder: 'ID of the email to move',
      condition: { field: 'operation', value: 'move_gmail' },
      required: true,
    },
    // Destination label selector (basic mode)
    {
      id: 'destinationLabel',
      title: 'Move To Label',
      type: 'folder-selector',
      canonicalParamId: 'addLabelIds',
      provider: 'google-email',
      serviceId: 'gmail',
      requiredScopes: ['https://www.googleapis.com/auth/gmail.labels'],
      placeholder: 'Select destination label',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: 'move_gmail' },
      required: true,
    },
    // Manual destination label input (advanced mode)
    {
      id: 'manualDestinationLabel',
      title: 'Move To Label',
      type: 'short-input',
      canonicalParamId: 'addLabelIds',
      placeholder: 'Enter label ID (e.g., INBOX, Label_123)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'move_gmail' },
      required: true,
    },
    // Source label selector (basic mode)
    {
      id: 'sourceLabel',
      title: 'Remove From Label',
      type: 'folder-selector',
      canonicalParamId: 'removeLabelIds',
      provider: 'google-email',
      serviceId: 'gmail',
      requiredScopes: ['https://www.googleapis.com/auth/gmail.labels'],
      placeholder: 'Select label to remove',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: 'move_gmail' },
      required: false,
    },
    // Manual source label input (advanced mode)
    {
      id: 'manualSourceLabel',
      title: 'Remove From Label',
      type: 'short-input',
      canonicalParamId: 'removeLabelIds',
      placeholder: 'Enter label ID to remove (e.g., INBOX)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'move_gmail' },
      required: false,
    },
    // Mark as Read/Unread, Archive/Unarchive, Delete - Message ID field
    {
      id: 'actionMessageId',
      title: 'Message ID',
      type: 'short-input',
      placeholder: 'ID of the email',
      condition: {
        field: 'operation',
        value: [
          'mark_read_gmail',
          'mark_unread_gmail',
          'archive_gmail',
          'unarchive_gmail',
          'delete_gmail',
        ],
      },
      required: true,
    },
    // Add/Remove Label - Message ID field
    {
      id: 'labelActionMessageId',
      title: 'Message ID',
      type: 'short-input',
      placeholder: 'ID of the email',
      condition: { field: 'operation', value: ['add_label_gmail', 'remove_label_gmail'] },
      required: true,
    },
    // Add/Remove Label - Label selector (basic mode)
    {
      id: 'labelManagement',
      title: 'Label',
      type: 'folder-selector',
      canonicalParamId: 'labelIds',
      provider: 'google-email',
      serviceId: 'gmail',
      requiredScopes: ['https://www.googleapis.com/auth/gmail.labels'],
      placeholder: 'Select label',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: ['add_label_gmail', 'remove_label_gmail'] },
      required: true,
    },
    // Add/Remove Label - Manual label input (advanced mode)
    {
      id: 'manualLabelManagement',
      title: 'Label',
      type: 'short-input',
      canonicalParamId: 'labelIds',
      placeholder: 'Enter label ID (e.g., INBOX, Label_123)',
      mode: 'advanced',
      condition: { field: 'operation', value: ['add_label_gmail', 'remove_label_gmail'] },
      required: true,
    },
    ...getTrigger('gmail_poller').subBlocks,
  ],
  tools: {
    access: [
      'gmail_send',
      'gmail_draft',
      'gmail_read',
      'gmail_search',
      'gmail_move',
      'gmail_mark_read',
      'gmail_mark_unread',
      'gmail_archive',
      'gmail_unarchive',
      'gmail_delete',
      'gmail_add_label',
      'gmail_remove_label',
    ],
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
          case 'move_gmail':
            return 'gmail_move'
          case 'mark_read_gmail':
            return 'gmail_mark_read'
          case 'mark_unread_gmail':
            return 'gmail_mark_unread'
          case 'archive_gmail':
            return 'gmail_archive'
          case 'unarchive_gmail':
            return 'gmail_unarchive'
          case 'delete_gmail':
            return 'gmail_delete'
          case 'add_label_gmail':
            return 'gmail_add_label'
          case 'remove_label_gmail':
            return 'gmail_remove_label'
          default:
            throw new Error(`Invalid Gmail operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          credential,
          folder,
          manualFolder,
          destinationLabel,
          manualDestinationLabel,
          sourceLabel,
          manualSourceLabel,
          moveMessageId,
          actionMessageId,
          labelActionMessageId,
          labelManagement,
          manualLabelManagement,
          ...rest
        } = params

        // Handle both selector and manual folder input
        const effectiveFolder = (folder || manualFolder || '').trim()

        if (rest.operation === 'read_gmail') {
          rest.folder = effectiveFolder || 'INBOX'
        }

        // Handle move operation
        if (rest.operation === 'move_gmail') {
          if (moveMessageId) {
            rest.messageId = moveMessageId
          }
          if (!rest.addLabelIds) {
            rest.addLabelIds = (destinationLabel || manualDestinationLabel || '').trim()
          }
          if (!rest.removeLabelIds) {
            rest.removeLabelIds = (sourceLabel || manualSourceLabel || '').trim()
          }
        }

        // Handle simple message ID operations
        if (
          [
            'mark_read_gmail',
            'mark_unread_gmail',
            'archive_gmail',
            'unarchive_gmail',
            'delete_gmail',
          ].includes(rest.operation)
        ) {
          if (actionMessageId) {
            rest.messageId = actionMessageId
          }
        }

        if (['add_label_gmail', 'remove_label_gmail'].includes(rest.operation)) {
          if (labelActionMessageId) {
            rest.messageId = labelActionMessageId
          }
          if (!rest.labelIds) {
            rest.labelIds = (labelManagement || manualLabelManagement || '').trim()
          }
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
    contentType: { type: 'string', description: 'Content type (text or html)' },
    threadId: { type: 'string', description: 'Thread ID to reply to (for threading)' },
    replyToMessageId: {
      type: 'string',
      description: 'Gmail message ID to reply to (use "id" field from results, not "messageId")',
    },
    cc: { type: 'string', description: 'CC recipients (comma-separated)' },
    bcc: { type: 'string', description: 'BCC recipients (comma-separated)' },
    attachments: { type: 'json', description: 'Files to attach (UserFile array)' },
    // Read operation inputs
    folder: { type: 'string', description: 'Gmail folder' },
    manualFolder: { type: 'string', description: 'Manual folder name' },
    readMessageId: { type: 'string', description: 'Message identifier for reading specific email' },
    unreadOnly: { type: 'boolean', description: 'Unread messages only' },
    includeAttachments: { type: 'boolean', description: 'Include email attachments' },
    // Search operation inputs
    query: { type: 'string', description: 'Search query' },
    maxResults: { type: 'number', description: 'Maximum results' },
    // Move operation inputs
    moveMessageId: { type: 'string', description: 'Message ID to move' },
    destinationLabel: { type: 'string', description: 'Destination label ID' },
    manualDestinationLabel: { type: 'string', description: 'Manual destination label ID' },
    sourceLabel: { type: 'string', description: 'Source label ID to remove' },
    manualSourceLabel: { type: 'string', description: 'Manual source label ID' },
    addLabelIds: { type: 'string', description: 'Label IDs to add' },
    removeLabelIds: { type: 'string', description: 'Label IDs to remove' },
    // Action operation inputs
    actionMessageId: { type: 'string', description: 'Message ID for actions' },
    labelActionMessageId: { type: 'string', description: 'Message ID for label actions' },
    labelManagement: { type: 'string', description: 'Label ID for management' },
    manualLabelManagement: { type: 'string', description: 'Manual label ID' },
    labelIds: { type: 'string', description: 'Label IDs for add/remove operations' },
  },
  outputs: {
    // Tool outputs
    content: { type: 'string', description: 'Response content' },
    metadata: { type: 'json', description: 'Email metadata' },
    attachments: { type: 'json', description: 'Email attachments array' },
    // Trigger outputs
    email_id: { type: 'string', description: 'Gmail message ID' },
    thread_id: { type: 'string', description: 'Gmail thread ID' },
    subject: { type: 'string', description: 'Email subject line' },
    from: { type: 'string', description: 'Sender email address' },
    to: { type: 'string', description: 'Recipient email address' },
    cc: { type: 'string', description: 'CC recipients (comma-separated)' },
    date: { type: 'string', description: 'Email date in ISO format' },
    body_text: { type: 'string', description: 'Plain text email body' },
    body_html: { type: 'string', description: 'HTML email body' },
    labels: { type: 'string', description: 'Email labels (comma-separated)' },
    has_attachments: { type: 'boolean', description: 'Whether email has attachments' },
    raw_email: { type: 'json', description: 'Complete raw email data from Gmail API (if enabled)' },
    timestamp: { type: 'string', description: 'Event timestamp' },
  },
  triggers: {
    enabled: true,
    available: ['gmail_poller'],
  },
}
