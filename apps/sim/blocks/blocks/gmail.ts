import { GmailIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { createVersionedToolSelector, normalizeFileInput } from '@/blocks/utils'
import type { GmailToolResponse } from '@/tools/gmail/types'
import { getTrigger } from '@/triggers'

function selectGmailToolId(params: Record<string, any>): string {
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
}

export const GmailBlock: BlockConfig<GmailToolResponse> = {
  type: 'gmail',
  name: 'Gmail (Legacy)',
  description: 'Send, read, search, and move Gmail messages or trigger workflows from Gmail events',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Gmail into the workflow. Can send, read, search, and move emails. Can be used in trigger mode to trigger a workflow when a new email is received.',
  docsLink: 'https://docs.sim.ai/tools/gmail',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: GmailIcon,
  hideFromToolbar: true,
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
      wandConfig: {
        enabled: true,
        prompt: `Generate a clear, professional email subject line based on the user's request.
The subject should be concise yet informative about the email's purpose.

Return ONLY the subject line - no explanations, no extra text.`,
        placeholder: 'Describe the email topic...',
      },
    },
    {
      id: 'body',
      title: 'Body',
      type: 'long-input',
      placeholder: 'Email content',
      condition: { field: 'operation', value: ['send_gmail', 'draft_gmail'] },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate professional email content based on the user's request.
The email should:
- Have an appropriate greeting
- Be clear and well-structured
- Have a professional tone
- Include a proper closing

Return ONLY the email body - no explanations, no extra text.`,
        placeholder: 'Describe the email you want to write...',
      },
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
      placeholder: 'Read specific email by ID (overrides label/folder)',
      condition: { field: 'operation', value: 'read_gmail' },
      mode: 'advanced',
    },
    // Search Fields
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Enter search terms',
      condition: { field: 'operation', value: 'search_gmail' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a Gmail search query based on the user's request.
Gmail search supports operators like:
- from: to: subject: has:attachment
- is:unread is:starred is:important
- before: after: older: newer:
- filename: label: category:

Return ONLY the search query - no explanations, no extra text.`,
        placeholder: 'Describe what emails you want to find...',
      },
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
      id: 'labelSelector',
      title: 'Label',
      type: 'folder-selector',
      canonicalParamId: 'manageLabelId',
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
      id: 'manualLabelId',
      title: 'Label',
      type: 'short-input',
      canonicalParamId: 'manageLabelId',
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
      tool: selectGmailToolId,
      params: (params) => {
        const {
          credential,
          folder,
          addLabelIds,
          removeLabelIds,
          moveMessageId,
          actionMessageId,
          labelActionMessageId,
          manageLabelId,
          attachments,
          ...rest
        } = params

        // Use canonical 'folder' param directly
        const effectiveFolder = folder ? String(folder).trim() : ''

        if (rest.operation === 'read_gmail') {
          rest.folder = effectiveFolder || 'INBOX'
        }

        // Handle move operation - use canonical params addLabelIds and removeLabelIds
        if (rest.operation === 'move_gmail') {
          if (moveMessageId) {
            rest.messageId = moveMessageId
          }
          if (addLabelIds) {
            rest.addLabelIds = String(addLabelIds).trim()
          }
          if (removeLabelIds) {
            rest.removeLabelIds = String(removeLabelIds).trim()
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
          if (manageLabelId) {
            rest.labelIds = String(manageLabelId).trim()
          }
        }

        // Normalize attachments for send/draft operations - use canonical 'attachments' param
        const normalizedAttachments = normalizeFileInput(attachments)

        return {
          ...rest,
          credential,
          ...(normalizedAttachments && { attachments: normalizedAttachments }),
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
    attachments: { type: 'array', description: 'Files to attach (canonical param)' },
    // Read operation inputs
    folder: { type: 'string', description: 'Gmail folder (canonical param)' },
    readMessageId: { type: 'string', description: 'Message identifier for reading specific email' },
    unreadOnly: { type: 'boolean', description: 'Unread messages only' },
    includeAttachments: { type: 'boolean', description: 'Include email attachments' },
    // Search operation inputs
    query: { type: 'string', description: 'Search query' },
    maxResults: { type: 'number', description: 'Maximum results' },
    // Move operation inputs
    moveMessageId: { type: 'string', description: 'Message ID to move' },
    addLabelIds: { type: 'string', description: 'Label IDs to add (canonical param)' },
    removeLabelIds: { type: 'string', description: 'Label IDs to remove (canonical param)' },
    // Action operation inputs
    actionMessageId: { type: 'string', description: 'Message ID for actions' },
    labelActionMessageId: { type: 'string', description: 'Message ID for label actions' },
    manageLabelId: {
      type: 'string',
      description: 'Label ID for add/remove operations (canonical param)',
    },
    labelIds: { type: 'string', description: 'Label IDs to monitor (trigger)' },
  },
  outputs: {
    // Tool outputs
    content: { type: 'string', description: 'Response content' },
    metadata: { type: 'json', description: 'Email metadata' },
    attachments: { type: 'file[]', description: 'Email attachments array' },
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

export const GmailV2Block: BlockConfig<GmailToolResponse> = {
  ...GmailBlock,
  type: 'gmail_v2',
  name: 'Gmail',
  hideFromToolbar: false,
  tools: {
    ...GmailBlock.tools,
    access: [
      'gmail_send_v2',
      'gmail_draft_v2',
      'gmail_read_v2',
      'gmail_search_v2',
      'gmail_move_v2',
      'gmail_mark_read_v2',
      'gmail_mark_unread_v2',
      'gmail_archive_v2',
      'gmail_unarchive_v2',
      'gmail_delete_v2',
      'gmail_add_label_v2',
      'gmail_remove_label_v2',
    ],
    config: {
      ...GmailBlock.tools?.config,
      tool: createVersionedToolSelector({
        baseToolSelector: selectGmailToolId,
        suffix: '_v2',
        fallbackToolId: 'gmail_send_v2',
      }),
    },
  },
  outputs: {
    // V2 tool outputs (API-aligned)
    id: { type: 'string', description: 'Gmail message ID' },
    threadId: { type: 'string', description: 'Gmail thread ID' },
    labelIds: { type: 'array', description: 'Email label IDs' },
    from: { type: 'string', description: 'Sender' },
    to: { type: 'string', description: 'To' },
    subject: { type: 'string', description: 'Subject' },
    date: { type: 'string', description: 'Date' },
    body: { type: 'string', description: 'Email body text (best-effort)' },
    results: { type: 'json', description: 'Search/read summary results' },
    attachments: { type: 'file[]', description: 'Downloaded attachments (if enabled)' },

    // Draft-specific outputs
    draftId: {
      type: 'string',
      description: 'Draft ID',
      condition: { field: 'operation', value: 'draft_gmail' },
    },
    messageId: {
      type: 'string',
      description: 'Gmail message ID for the draft',
      condition: { field: 'operation', value: 'draft_gmail' },
    },

    // Trigger outputs (unchanged)
    email_id: { type: 'string', description: 'Gmail message ID' },
    thread_id: { type: 'string', description: 'Gmail thread ID' },
    cc: { type: 'string', description: 'CC recipients (comma-separated)' },
    body_text: { type: 'string', description: 'Plain text email body' },
    body_html: { type: 'string', description: 'HTML email body' },
    labels: { type: 'string', description: 'Email labels (comma-separated)' },
    has_attachments: { type: 'boolean', description: 'Whether email has attachments' },
    raw_email: { type: 'json', description: 'Complete raw email data from Gmail API (if enabled)' },
    timestamp: { type: 'string', description: 'Event timestamp' },
  },
}
