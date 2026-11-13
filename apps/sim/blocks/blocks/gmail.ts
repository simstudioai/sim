import { ClipboardList } from '@sim/emcn/icons'
import { GmailIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import {
  createVersionedToolSelector,
  normalizeFileInput,
  SERVICE_ACCOUNT_SUBBLOCKS,
} from '@/blocks/utils'
import { getTrigger } from '@/triggers'

function selectGmailToolId(params: Record<string, any>): string {
  switch (params.operation) {
    case 'send_gmail':
      return 'gmail_send'
    case 'draft_gmail':
      return 'gmail_draft'
    case 'edit_draft_gmail':
      return 'gmail_edit_draft_v2'
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

/**
 * Canonical basic/advanced pairs, shared by the card sentences below. Listing
 * both members is what keeps a sentence working for an advanced-mode user, who
 * has only the manual field filled.
 */
const ATTACHMENTS_FIELD = ['attachmentFiles', 'attachments'] as const
const FOLDER_FIELD = ['folder', 'manualFolder'] as const
const DESTINATION_LABEL_FIELD = ['destinationLabel', 'manualDestinationLabel'] as const
const SOURCE_LABEL_FIELD = ['sourceLabel', 'manualSourceLabel'] as const
const MANAGE_LABEL_FIELD = ['labelSelector', 'manualLabelId'] as const

export const GmailBlock: BlockConfig = {
  type: 'gmail',
  name: 'Gmail (Legacy)',
  description: 'Send, read, search, and move Gmail messages or trigger workflows from Gmail events',
  authMode: AuthMode.OAuth,
  longDescription:
    'Send or draft messages, read and search mail, and manage labels and read status. New-mail triggers can start workflows.',
  docsLink: 'https://docs.sim.ai/integrations/gmail',
  category: 'tools',
  integrationType: IntegrationType.Email,
  bgColor: '#FFFFFF',
  icon: GmailIcon,
  canvasPresentation: {
    typeLabel: 'Gmail',
    defaultTitle: 'Send Email',
    triggerSentences: {
      byTrigger: {
        gmail_poller: [
          'Run on email',
          { text: 'to', field: 'labelIds', core: true },
          { text: 'matching', field: 'searchQuery' },
        ],
      },
    },
    operationSubBlockId: 'operation',
    operationRowTitle: 'Action',
    sentences: {
      byOperation: {
        send_gmail: [
          { text: 'Send', field: 'subject', core: true },
          { text: 'to', field: 'to', core: true },
          { text: ', attaching', field: ATTACHMENTS_FIELD },
        ],
        draft_gmail: [
          { text: 'Draft', field: 'subject', core: true },
          { text: 'to', field: 'to', core: true },
          { text: ', attaching', field: ATTACHMENTS_FIELD },
        ],
        edit_draft_gmail: [
          { text: 'Update draft', field: 'draftId', core: true },
          { text: ', addressed to', field: 'to' },
        ],
        read_gmail: [
          {
            text: 'Read up to',
            field: 'maxResults',
            after: 'messages',
            core: true,
          },
          { text: 'in', field: FOLDER_FIELD, core: true },
        ],
        search_gmail: [
          { text: 'Search messages matching', field: 'query', core: true },
          { text: ', up to', field: 'maxResults', after: 'results' },
        ],
        move_gmail: [
          { text: 'Move message', field: 'moveMessageId', core: true },
          { text: 'from', field: SOURCE_LABEL_FIELD },
          { text: 'to', field: DESTINATION_LABEL_FIELD, core: true },
        ],
        mark_read_gmail: [
          { text: 'Mark message', field: 'actionMessageId', core: true, after: 'as read' },
        ],
        mark_unread_gmail: [
          { text: 'Mark message', field: 'actionMessageId', core: true, after: 'as unread' },
        ],
        archive_gmail: [{ text: 'Archive message', field: 'actionMessageId', core: true }],
        unarchive_gmail: [{ text: 'Unarchive message', field: 'actionMessageId', core: true }],
        delete_gmail: [
          { text: 'Move message', field: 'actionMessageId', core: true, after: 'to trash' },
        ],
        add_label_gmail: [
          { text: 'Add label', field: MANAGE_LABEL_FIELD, core: true },
          { text: 'to message', field: 'labelActionMessageId' },
        ],
        remove_label_gmail: [
          { text: 'Remove label', field: MANAGE_LABEL_FIELD, core: true },
          { text: 'from message', field: 'labelActionMessageId' },
        ],
      },
    },
  },
  hideFromToolbar: true,
  sunset: { status: 'legacy', replacedBy: 'gmail_v2' },
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
        { label: 'Edit Draft', id: 'edit_draft_gmail' },
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
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      serviceId: 'gmail',
      requiredScopes: getScopesForService('gmail'),
      placeholder: 'Select Gmail account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Gmail Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    ...SERVICE_ACCOUNT_SUBBLOCKS,
    // Edit Draft - Draft ID
    {
      id: 'draftId',
      title: 'Draft ID',
      type: 'short-input',
      placeholder: 'ID of the draft to update',
      condition: { field: 'operation', value: 'edit_draft_gmail' },
      required: true,
    },
    // Send Email Fields
    {
      id: 'to',
      title: 'To',
      canvasNoun: 'a recipient',
      type: 'short-input',
      placeholder: 'Recipient email address',
      condition: { field: 'operation', value: ['send_gmail', 'draft_gmail', 'edit_draft_gmail'] },
      required: true,
    },
    {
      id: 'subject',
      title: 'Subject',
      type: 'short-input',
      placeholder: 'Email subject',
      condition: { field: 'operation', value: ['send_gmail', 'draft_gmail', 'edit_draft_gmail'] },
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
      condition: { field: 'operation', value: ['send_gmail', 'draft_gmail', 'edit_draft_gmail'] },
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
      condition: { field: 'operation', value: ['send_gmail', 'draft_gmail', 'edit_draft_gmail'] },
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
      condition: { field: 'operation', value: ['send_gmail', 'draft_gmail', 'edit_draft_gmail'] },
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
      condition: { field: 'operation', value: ['send_gmail', 'draft_gmail', 'edit_draft_gmail'] },
      mode: 'advanced',
      required: false,
    },
    // Advanced Settings - Threading
    {
      id: 'threadId',
      title: 'Thread ID',
      type: 'short-input',
      placeholder: 'Thread ID to reply to (for threading)',
      condition: { field: 'operation', value: ['send_gmail', 'draft_gmail', 'edit_draft_gmail'] },
      mode: 'advanced',
      required: false,
    },
    {
      id: 'replyToMessageId',
      title: 'Reply to Message ID',
      type: 'short-input',
      placeholder: 'Gmail message ID (not RFC Message-ID) - use the "id" field from results',
      condition: { field: 'operation', value: ['send_gmail', 'draft_gmail', 'edit_draft_gmail'] },
      mode: 'advanced',
      required: false,
    },
    // Advanced Settings - Additional Recipients
    {
      id: 'cc',
      title: 'CC',
      type: 'short-input',
      placeholder: 'CC recipients (comma-separated)',
      condition: { field: 'operation', value: ['send_gmail', 'draft_gmail', 'edit_draft_gmail'] },
      mode: 'advanced',
      required: false,
    },
    {
      id: 'bcc',
      title: 'BCC',
      type: 'short-input',
      placeholder: 'BCC recipients (comma-separated)',
      condition: { field: 'operation', value: ['send_gmail', 'draft_gmail', 'edit_draft_gmail'] },
      mode: 'advanced',
      required: false,
    },
    {
      id: 'replyTo',
      title: 'Reply-To',
      type: 'short-input',
      placeholder: 'Address replies should go to (e.g., support@example.com)',
      condition: { field: 'operation', value: ['send_gmail', 'draft_gmail', 'edit_draft_gmail'] },
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
      selectorKey: 'gmail.labels',
      requiredScopes: getScopesForService('gmail'),
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
      dependsOn: ['credential'],
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
      placeholder:
        'Maximum number of results (read: default 1, max 10; search: default 100, max 500)',
      condition: { field: 'operation', value: ['search_gmail', 'read_gmail'] },
    },
    {
      id: 'pageToken',
      title: 'Page Token',
      type: 'short-input',
      placeholder: 'nextPageToken from a previous search',
      condition: { field: 'operation', value: 'search_gmail' },
      mode: 'advanced',
      required: false,
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
      selectorKey: 'gmail.labels',
      requiredScopes: getScopesForService('gmail'),
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
      dependsOn: ['credential'],
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
      selectorKey: 'gmail.labels',
      requiredScopes: getScopesForService('gmail'),
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
      dependsOn: ['credential'],
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
      selectorKey: 'gmail.labels',
      requiredScopes: getScopesForService('gmail'),
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
      dependsOn: ['credential'],
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
      'gmail_edit_draft_v2',
    ],
    config: {
      tool: selectGmailToolId,
      params: (params) => {
        const {
          oauthCredential,
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
          oauthCredential,
          ...(normalizedAttachments && { attachments: normalizedAttachments }),
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Gmail access token' },
    // Send operation inputs
    draftId: { type: 'string', description: 'Draft ID for edit operations' },
    to: { type: 'string', description: 'Recipient email address' },
    subject: { type: 'string', description: 'Email subject' },
    body: { type: 'string', description: 'Email content' },
    contentType: { type: 'string', description: 'Content type (text or html)' },
    threadId: { type: 'string', description: 'Thread ID to reply to (for threading)' },
    replyToMessageId: {
      type: 'string',
      description: 'Gmail message ID to reply to (use "id" field from results, not "rfcMessageId")',
    },
    cc: { type: 'string', description: 'CC recipients (comma-separated)' },
    bcc: { type: 'string', description: 'BCC recipients (comma-separated)' },
    replyTo: { type: 'string', description: 'Reply-To address for the outgoing email' },
    attachments: { type: 'array', description: 'Files to attach (canonical param)' },
    // Read operation inputs
    folder: { type: 'string', description: 'Gmail folder (canonical param)' },
    readMessageId: { type: 'string', description: 'Message identifier for reading specific email' },
    unreadOnly: { type: 'boolean', description: 'Unread messages only' },
    includeAttachments: { type: 'boolean', description: 'Include email attachments' },
    // Search operation inputs
    query: { type: 'string', description: 'Search query' },
    maxResults: { type: 'number', description: 'Maximum results' },
    pageToken: {
      type: 'string',
      description: 'Search page token (nextPageToken from a prior search)',
    },
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
    metadata: {
      type: 'json',
      description:
        'Email metadata (id, threadId, labelIds, from, to, cc, bcc, replyTo, subject, date, rfcMessageId, inReplyTo, references, snippet, internalDate, hasAttachments, attachmentCount); search/multi-read returns results[] with the same header fields plus nextPageToken and resultSizeEstimate for search',
    },
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

const LABEL_WRITE_OPERATIONS = ['create_label_gmail', 'update_label_gmail']
const LABEL_TARGET_OPERATIONS = ['update_label_gmail', 'delete_label_gmail']
const THREAD_TARGET_OPERATIONS = ['get_thread_gmail', 'trash_thread_gmail', 'untrash_thread_gmail']
const LIST_OPERATIONS = ['list_drafts_gmail', 'list_threads_gmail']
const PAGINATED_OPERATIONS = ['search_gmail', ...LIST_OPERATIONS]
const LABEL_TARGET_FIELD = ['labelTarget', 'manualLabelTarget'] as const

/** Operations only the V2 block exposes; their tools exist only in a `_v2` version. */
const GMAIL_V2_OPERATION_TOOLS: Record<string, string> = {
  list_labels_gmail: 'gmail_list_labels_v2',
  create_label_gmail: 'gmail_create_label_v2',
  update_label_gmail: 'gmail_update_label_v2',
  delete_label_gmail: 'gmail_delete_label_v2',
  list_drafts_gmail: 'gmail_list_drafts_v2',
  get_draft_gmail: 'gmail_get_draft_v2',
  delete_draft_gmail: 'gmail_delete_draft_v2',
  list_threads_gmail: 'gmail_list_threads_v2',
  get_thread_gmail: 'gmail_get_thread_v2',
  trash_thread_gmail: 'gmail_trash_thread_v2',
  untrash_thread_gmail: 'gmail_untrash_thread_v2',
}

function selectGmailV2ToolId(params: Record<string, unknown>): string {
  const operation = typeof params.operation === 'string' ? params.operation : ''
  return (
    (Object.hasOwn(GMAIL_V2_OPERATION_TOOLS, operation) && GMAIL_V2_OPERATION_TOOLS[operation]) ||
    selectGmailToolId(params)
  )
}

const GMAIL_V2_OPERATION_OPTIONS = [
  { label: 'List Labels', id: 'list_labels_gmail' },
  { label: 'Create Label', id: 'create_label_gmail' },
  { label: 'Update Label', id: 'update_label_gmail' },
  { label: 'Delete Label', id: 'delete_label_gmail' },
  { label: 'List Drafts', id: 'list_drafts_gmail' },
  { label: 'Get Draft', id: 'get_draft_gmail' },
  { label: 'Delete Draft', id: 'delete_draft_gmail' },
  { label: 'List Threads', id: 'list_threads_gmail' },
  { label: 'Get Thread', id: 'get_thread_gmail' },
  { label: 'Trash Thread', id: 'trash_thread_gmail' },
  { label: 'Untrash Thread', id: 'untrash_thread_gmail' },
]

const GMAIL_V2_SUBBLOCKS: BlockConfig['subBlocks'] = [
  {
    id: 'labelTarget',
    title: 'Label',
    type: 'folder-selector',
    canonicalParamId: 'labelId',
    serviceId: 'gmail',
    selectorKey: 'gmail.labels',
    requiredScopes: getScopesForService('gmail'),
    placeholder: 'Select label',
    dependsOn: ['credential'],
    mode: 'basic',
    condition: { field: 'operation', value: LABEL_TARGET_OPERATIONS },
    required: true,
  },
  {
    id: 'manualLabelTarget',
    title: 'Label ID',
    type: 'short-input',
    canonicalParamId: 'labelId',
    placeholder: 'Enter label ID (e.g., Label_123)',
    dependsOn: ['credential'],
    mode: 'advanced',
    condition: { field: 'operation', value: LABEL_TARGET_OPERATIONS },
    required: true,
  },
  {
    id: 'labelName',
    title: 'Label Name',
    type: 'short-input',
    placeholder: 'Label display name (e.g., Clients/Acme)',
    condition: { field: 'operation', value: LABEL_WRITE_OPERATIONS },
    required: { field: 'operation', value: 'create_label_gmail' },
  },
  {
    id: 'messageListVisibility',
    title: 'Message List Visibility',
    type: 'dropdown',
    options: [
      { label: 'Default', id: '' },
      { label: 'Show', id: 'show' },
      { label: 'Hide', id: 'hide' },
    ],
    value: () => '',
    condition: { field: 'operation', value: LABEL_WRITE_OPERATIONS },
    mode: 'advanced',
    required: false,
  },
  {
    id: 'labelListVisibility',
    title: 'Label List Visibility',
    type: 'dropdown',
    options: [
      { label: 'Default', id: '' },
      { label: 'Show', id: 'labelShow' },
      { label: 'Show if unread', id: 'labelShowIfUnread' },
      { label: 'Hide', id: 'labelHide' },
    ],
    value: () => '',
    condition: { field: 'operation', value: LABEL_WRITE_OPERATIONS },
    mode: 'advanced',
    required: false,
  },
  {
    id: 'targetThreadId',
    title: 'Thread ID',
    type: 'short-input',
    placeholder: 'ID of the thread (threadId from Read, Search, or List Threads)',
    condition: { field: 'operation', value: THREAD_TARGET_OPERATIONS },
    required: true,
  },
  {
    id: 'threadFormat',
    title: 'Format',
    type: 'dropdown',
    options: [
      { label: 'Full', id: 'full' },
      { label: 'Metadata', id: 'metadata' },
      { label: 'Minimal', id: 'minimal' },
    ],
    value: () => 'full',
    condition: { field: 'operation', value: 'get_thread_gmail' },
    mode: 'advanced',
    required: false,
  },
  {
    id: 'listQuery',
    title: 'Search Query',
    type: 'short-input',
    placeholder: 'Optional Gmail search filter (e.g., from:alice is:unread)',
    condition: { field: 'operation', value: LIST_OPERATIONS },
    required: false,
    wandConfig: {
      enabled: true,
      prompt: `Generate a Gmail search query based on the user's request.
Gmail search supports operators like:
- from: to: subject: has:attachment
- is:unread is:starred is:important
- before: after: older: newer:
- filename: label: category:

Return ONLY the search query - no explanations, no extra text.`,
      placeholder: 'Describe which drafts or threads you want...',
    },
  },
  {
    id: 'threadLabelIds',
    title: 'Label IDs',
    type: 'short-input',
    placeholder: 'Comma-separated label IDs (e.g., INBOX,Label_123)',
    condition: { field: 'operation', value: 'list_threads_gmail' },
    mode: 'advanced',
    required: false,
    wandConfig: {
      enabled: true,
      prompt: `Generate a comma-separated list of Gmail label IDs based on the user's request.
System labels are uppercase (INBOX, SENT, DRAFT, SPAM, TRASH, STARRED, IMPORTANT, UNREAD); custom labels look like Label_123.

Return ONLY the comma-separated label IDs - no explanations, no extra text.`,
      placeholder: 'Describe which labels to filter by...',
    },
  },
]

function buildGmailV2SubBlocks(): BlockConfig['subBlocks'] {
  return GmailBlock.subBlocks.flatMap((subBlock) => {
    switch (subBlock.id) {
      case 'operation':
        return [
          {
            ...subBlock,
            options: [
              ...(Array.isArray(subBlock.options) ? subBlock.options : []),
              ...GMAIL_V2_OPERATION_OPTIONS,
            ],
          },
        ]
      case 'draftId':
        return [
          {
            ...subBlock,
            placeholder: 'ID of the draft (from List Drafts)',
            condition: {
              field: 'operation',
              value: ['edit_draft_gmail', 'get_draft_gmail', 'delete_draft_gmail'],
            },
          },
        ]
      case 'maxResults':
        return [
          {
            ...subBlock,
            placeholder:
              'Maximum number of results (read: default 1, max 10; search and lists: default 100, max 500)',
            condition: { field: 'operation', value: ['read_gmail', ...PAGINATED_OPERATIONS] },
          },
        ]
      case 'pageToken':
        return [
          {
            ...subBlock,
            placeholder: 'nextPageToken from a previous search or list',
            condition: { field: 'operation', value: PAGINATED_OPERATIONS },
          },
        ]
      case 'manualLabelId':
        return [subBlock, ...GMAIL_V2_SUBBLOCKS]
      default:
        return [subBlock]
    }
  })
}

export const GmailV2Block: BlockConfig = {
  ...GmailBlock,
  sunset: undefined,
  type: 'gmail_v2',
  name: 'Gmail',
  hideFromToolbar: false,
  integrationType: IntegrationType.Email,
  canvasPresentation: GmailBlock.canvasPresentation && {
    ...GmailBlock.canvasPresentation,
    sentences: {
      byOperation: {
        ...GmailBlock.canvasPresentation.sentences?.byOperation,
        list_labels_gmail: ['List labels'],
        create_label_gmail: [{ text: 'Create label', field: 'labelName', core: true }],
        update_label_gmail: [
          { text: 'Update label', field: LABEL_TARGET_FIELD, core: true },
          { text: ', renaming it to', field: 'labelName' },
        ],
        delete_label_gmail: [{ text: 'Delete label', field: LABEL_TARGET_FIELD, core: true }],
        list_drafts_gmail: ['List drafts', { text: 'matching', field: 'listQuery' }],
        get_draft_gmail: [{ text: 'Get draft', field: 'draftId', core: true }],
        delete_draft_gmail: [{ text: 'Delete draft', field: 'draftId', core: true }],
        list_threads_gmail: ['List threads', { text: 'matching', field: 'listQuery' }],
        get_thread_gmail: [{ text: 'Get thread', field: 'targetThreadId', core: true }],
        trash_thread_gmail: [
          { text: 'Move thread', field: 'targetThreadId', core: true, after: 'to trash' },
        ],
        untrash_thread_gmail: [
          { text: 'Restore thread', field: 'targetThreadId', core: true, after: 'from trash' },
        ],
      },
    },
  },
  subBlocks: buildGmailV2SubBlocks(),
  tools: {
    ...GmailBlock.tools,
    access: [
      'gmail_send_v2',
      'gmail_draft_v2',
      'gmail_edit_draft_v2',
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
      'gmail_list_labels_v2',
      'gmail_create_label_v2',
      'gmail_update_label_v2',
      'gmail_delete_label_v2',
      'gmail_list_drafts_v2',
      'gmail_get_draft_v2',
      'gmail_delete_draft_v2',
      'gmail_list_threads_v2',
      'gmail_get_thread_v2',
      'gmail_trash_thread_v2',
      'gmail_untrash_thread_v2',
    ],
    config: {
      ...GmailBlock.tools?.config,
      tool: createVersionedToolSelector({
        baseToolSelector: selectGmailV2ToolId,
        suffix: '_v2',
        fallbackToolId: 'gmail_send_v2',
      }),
      params: (params) => {
        const mapped = GmailBlock.tools?.config?.params?.(params) ?? params
        const {
          labelName,
          targetThreadId,
          threadFormat,
          listQuery,
          threadLabelIds,
          messageListVisibility,
          labelListVisibility,
          ...rest
        } = mapped
        if (LABEL_WRITE_OPERATIONS.includes(rest.operation)) {
          rest.name = labelName || undefined
          rest.messageListVisibility = messageListVisibility || undefined
          rest.labelListVisibility = labelListVisibility || undefined
        }
        if (THREAD_TARGET_OPERATIONS.includes(rest.operation)) {
          rest.threadId = targetThreadId
          rest.format = threadFormat || undefined
        }
        if (LIST_OPERATIONS.includes(rest.operation)) {
          rest.query = listQuery || undefined
          rest.labelIds = threadLabelIds ? String(threadLabelIds).trim() : undefined
        }
        return rest
      },
    },
  },
  inputs: {
    ...GmailBlock.inputs,
    labelId: { type: 'string', description: 'Label ID to update or delete (canonical param)' },
    labelName: { type: 'string', description: 'Label display name' },
    messageListVisibility: {
      type: 'string',
      description: 'Message list visibility for the label (show or hide)',
    },
    labelListVisibility: {
      type: 'string',
      description: 'Label list visibility (labelShow, labelShowIfUnread, or labelHide)',
    },
    targetThreadId: { type: 'string', description: 'Thread ID for thread operations' },
    threadFormat: { type: 'string', description: 'Thread format (full, metadata, or minimal)' },
    listQuery: { type: 'string', description: 'Search filter for listing drafts or threads' },
    threadLabelIds: { type: 'string', description: 'Comma-separated label IDs to filter threads' },
  },
  outputs: {
    // V2 tool outputs (API-aligned)
    id: {
      type: 'string',
      description:
        'Gmail message ID (thread ID for thread operations, label ID for label operations, draft ID for Get Draft)',
    },
    threadId: { type: 'string', description: 'Gmail thread ID' },
    labelIds: { type: 'array', description: 'Email label IDs' },
    from: { type: 'string', description: 'Sender' },
    to: { type: 'string', description: 'To' },
    bcc: { type: 'string', description: 'Bcc recipients (only on messages you sent or drafted)' },
    replyTo: { type: 'string', description: 'Reply-To header' },
    subject: { type: 'string', description: 'Subject' },
    date: { type: 'string', description: 'Date' },
    rfcMessageId: {
      type: 'string',
      description: 'RFC Message-ID header (not the Gmail message id)',
    },
    inReplyTo: { type: 'string', description: 'In-Reply-To header' },
    references: { type: 'string', description: 'References header' },
    snippet: { type: 'string', description: 'Short excerpt of the message text' },
    internalDate: {
      type: 'string',
      description: 'Gmail internal creation timestamp in epoch milliseconds',
    },
    body: { type: 'string', description: 'Email body text (best-effort)' },
    results: {
      type: 'json',
      description:
        'Search/read summary results [{id, threadId, subject, from, to, cc, bcc, replyTo, date, snippet, rfcMessageId, inReplyTo, references, internalDate}]',
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for the next page of results',
      condition: { field: 'operation', value: PAGINATED_OPERATIONS },
    },
    resultSizeEstimate: {
      type: 'number',
      description: 'Estimated total number of results',
      condition: { field: 'operation', value: PAGINATED_OPERATIONS },
    },
    name: {
      type: 'string',
      description: 'Label display name',
      condition: { field: 'operation', value: LABEL_WRITE_OPERATIONS },
    },
    type: {
      type: 'string',
      description: 'Label type (system or user)',
      condition: { field: 'operation', value: LABEL_WRITE_OPERATIONS },
    },
    messageListVisibility: {
      type: 'string',
      description: 'Message list visibility of the label',
      condition: { field: 'operation', value: LABEL_WRITE_OPERATIONS },
    },
    labelListVisibility: {
      type: 'string',
      description: 'Label list visibility of the label',
      condition: { field: 'operation', value: LABEL_WRITE_OPERATIONS },
    },
    labelId: {
      type: 'string',
      description: 'ID of the deleted label',
      condition: { field: 'operation', value: 'delete_label_gmail' },
    },
    deleted: {
      type: 'boolean',
      description: 'Whether the label or draft was deleted',
      condition: { field: 'operation', value: ['delete_label_gmail', 'delete_draft_gmail'] },
    },
    drafts: {
      type: 'json',
      description: 'Drafts [{id, messageId, threadId}]',
      condition: { field: 'operation', value: 'list_drafts_gmail' },
    },
    threads: {
      type: 'json',
      description: 'Threads [{id, snippet, historyId}]',
      condition: { field: 'operation', value: 'list_threads_gmail' },
    },
    messages: {
      type: 'json',
      description:
        'Thread messages [{id, threadId, labelIds, snippet, from, to, cc, bcc, replyTo, subject, date, rfcMessageId, inReplyTo, references, internalDate, body}]',
      condition: { field: 'operation', value: 'get_thread_gmail' },
    },
    historyId: {
      type: 'string',
      description: 'ID of the last history record that modified the thread',
      condition: { field: 'operation', value: 'get_thread_gmail' },
    },
    trashed: {
      type: 'boolean',
      description: 'Whether the thread was moved to trash',
      condition: { field: 'operation', value: 'trash_thread_gmail' },
    },
    untrashed: {
      type: 'boolean',
      description: 'Whether the thread was restored from trash',
      condition: { field: 'operation', value: 'untrash_thread_gmail' },
    },
    attachments: { type: 'file[]', description: 'Downloaded attachments (if enabled)' },

    // Draft-specific outputs
    draftId: {
      type: 'string',
      description: 'Draft ID',
      condition: {
        field: 'operation',
        value: ['draft_gmail', 'edit_draft_gmail', 'delete_draft_gmail'],
      },
    },
    messageId: {
      type: 'string',
      description: 'Gmail message ID for the draft',
      condition: {
        field: 'operation',
        value: ['draft_gmail', 'edit_draft_gmail', 'get_draft_gmail'],
      },
    },

    // Trigger outputs (unchanged)
    email_id: { type: 'string', description: 'Gmail message ID' },
    thread_id: { type: 'string', description: 'Gmail thread ID' },
    cc: { type: 'string', description: 'Cc recipients (raw Cc header, comma-separated)' },
    body_text: { type: 'string', description: 'Plain text email body' },
    body_html: { type: 'string', description: 'HTML email body' },
    labels: {
      type: 'json',
      description:
        'Email labels (trigger, comma-separated); for List Labels, the label array [{id, name, type, messageListVisibility, labelListVisibility}]',
    },
    has_attachments: { type: 'boolean', description: 'Whether email has attachments' },
    raw_email: { type: 'json', description: 'Complete raw email data from Gmail API (if enabled)' },
    timestamp: { type: 'string', description: 'Event timestamp' },
  },
}

export const GmailBlockMeta = {
  tags: ['google-workspace', 'messaging'],
  url: 'https://www.google.com/gmail/about',
  templates: [
    {
      icon: GmailIcon,
      title: 'Gmail auto-reply agent',
      prompt:
        'Create a workflow that reads my Gmail inbox, identifies emails that need a response, and drafts contextual replies for each one. Schedule it to run every hour.',
      image: '/templates/gmail-agent-dark.png',
      modules: ['agent', 'workflows'],
      category: 'popular',
      tags: ['individual', 'communication', 'automation'],
      featured: true,
    },
    {
      icon: GmailIcon,
      title: 'Gmail outbound sequence builder',
      prompt:
        'Build a workflow that reads leads from my table, researches each prospect and their company on the web, writes a personalized cold email tailored to their role and pain points, and sends it via Gmail. Schedule it to run daily to process new leads automatically.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication', 'automation'],
    },
    {
      icon: GmailIcon,
      title: 'Gmail knowledge search',
      prompt:
        'Create a knowledge base connected to my Gmail so all my emails are automatically synced, chunked, and searchable. Then build an agent I can ask things like "what did Sarah say about the pricing proposal?" or "find the contract John sent last month" and get instant answers with the original email cited.',
      modules: ['knowledge-base', 'agent'],
      category: 'support',
      tags: ['individual', 'research', 'communication'],
    },
    {
      icon: GmailIcon,
      title: 'Gmail triage assistant',
      prompt:
        'Build a workflow that scans my Gmail inbox every hour, categorizes emails by urgency and type (action needed, FYI, follow-up), drafts replies for routine messages, and sends me a prioritized summary in Slack so I only open what matters. Schedule it to run hourly.',
      modules: ['agent', 'scheduled', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'communication', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ClipboardList,
      title: 'Gmail invoice processor',
      prompt:
        'Build a workflow that processes invoice PDFs from Gmail, extracts vendor name, amount, due date, and line items, then logs everything to a tracking table and sends a Slack alert for invoices due within 7 days.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GmailIcon,
      title: 'Gmail to CRM activity logger',
      prompt:
        'Build a workflow that reads new Gmail threads with customers, extracts the contact, deal context, and key points discussed, and logs a timestamped activity to the matching HubSpot contact or deal so every conversation stays attached to the record.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'communication', 'automation'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: GmailIcon,
      title: 'Gmail attachment vault',
      prompt:
        'Create a workflow that watches Gmail for new emails with attachments, saves each attachment into a categorized folder in Google Drive based on sender and subject, and logs a row to a tracking table with the file link and source email.',
      modules: ['tables', 'files', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'automation', 'sync'],
      alsoIntegrations: ['google_drive'],
    },

    {
      icon: GmailIcon,
      title: 'Gmail to Notion email capture',
      prompt:
        'Build a workflow that monitors Gmail for incoming emails, extracts structured data from each one, and stores it as a Notion database entry — useful for lead capture, support tickets, and meeting scheduling.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['automation', 'communication'],
      featured: true,
      alsoIntegrations: ['notion'],
    },
  ],
  skills: [
    {
      name: 'triage-inbox',
      description:
        'Sort unread email by urgency and draft replies for the most important messages.',
      content:
        '# Triage Inbox\n\nReview unread Gmail messages and bring order to the inbox.\n\n## Steps\n1. Read unread messages from the relevant time window.\n2. Classify each as Urgent, Today, This week, or FYI based on sender, subject, and content.\n3. For Urgent and Today items, draft a concise reply.\n4. Flag anything that needs a meeting or a decision from someone else.\n\n## Output\nReturn a prioritized list: each message with its sender, a one-line summary, the assigned priority, and the draft reply where one was written. Do not send anything without confirmation.',
    },
    {
      name: 'summarize-email-thread',
      description: 'Condense a long email thread into the key points, decisions, and action items.',
      content:
        '# Summarize Email Thread\n\nGiven a Gmail thread, produce a tight summary.\n\n## Steps\n1. Read every message in the thread in order.\n2. Identify the core topic, what was decided, and what is still open.\n3. Pull out action items and who owns each.\n\n## Output\n- A one-sentence TL;DR.\n- Key decisions as bullets.\n- Action items with owners.\n- Open questions that still need an answer.',
    },
    {
      name: 'draft-reply-from-context',
      description: 'Draft a contextual reply to an email in the right tone, ready for review.',
      content:
        '# Draft Reply From Context\n\nWrite a reply to an incoming email that is ready to send after a quick review.\n\n## Steps\n1. Read the email and any prior thread context.\n2. Determine what the sender is asking for and the appropriate tone (formal, friendly, brief).\n3. Draft a reply that answers every question and proposes clear next steps.\n\n## Output\nA complete draft reply with subject and body. Keep it concise, match the sender style, and leave placeholders in brackets for any detail you cannot infer. Do not send without confirmation.',
    },
    {
      name: 'find-and-extract-emails',
      description: 'Search Gmail for messages matching a query and extract the details you need.',
      content:
        '# Find And Extract Emails\n\nLocate specific emails and pull structured information from them.\n\n## Steps\n1. Build a Gmail search query from the request (sender, subject keywords, date range, label, has attachment).\n2. Retrieve matching messages.\n3. Extract the requested fields from each, for example invoice amounts, order numbers, contact details, or attachment names.\n\n## Output\nA structured list of the matching emails with the extracted fields, plus a link or message id for each so the source can be opened.',
    },
  ],
} as const satisfies BlockMeta

export const GmailV2BlockMeta = {
  tags: ['google-workspace', 'messaging'],
  url: 'https://www.google.com/gmail/about',
} as const satisfies BlockMeta
