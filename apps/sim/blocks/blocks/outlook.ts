import { OutlookIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { OutlookResponse } from '@/tools/outlook/types'
import { getTrigger } from '@/triggers'

export const OutlookBlock: BlockConfig<OutlookResponse> = {
  type: 'outlook',
  name: 'Outlook',
  description: 'Send, read, draft, forward, and move Outlook email messages',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Outlook into the workflow. Can read, draft, send, forward, and move email messages. Can be used in trigger mode to trigger a workflow when a new email is received.',
  docsLink: 'https://docs.sim.ai/tools/outlook',
  category: 'tools',
  triggerAllowed: true,
  bgColor: '#E0E0E0',
  icon: OutlookIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Send Email', id: 'send_outlook' },
        { label: 'Draft Email', id: 'draft_outlook' },
        { label: 'Read Email', id: 'read_outlook' },
        { label: 'Forward Email', id: 'forward_outlook' },
        { label: 'Move Email', id: 'move_outlook' },
        { label: 'Mark as Read', id: 'mark_read_outlook' },
        { label: 'Mark as Unread', id: 'mark_unread_outlook' },
        { label: 'Delete Email', id: 'delete_outlook' },
        { label: 'Copy Email', id: 'copy_outlook' },
      ],
      value: () => 'send_outlook',
    },
    {
      id: 'credential',
      title: 'Microsoft Account',
      type: 'oauth-input',
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
      placeholder: 'Recipient email address',
      condition: {
        field: 'operation',
        value: ['send_outlook', 'draft_outlook', 'forward_outlook'],
      },
      required: true,
    },
    {
      id: 'messageId',
      title: 'Message ID',
      type: 'short-input',
      placeholder: 'Message ID to forward',
      condition: { field: 'operation', value: ['forward_outlook'] },
      required: true,
    },
    {
      id: 'comment',
      title: 'Comment',
      type: 'long-input',
      placeholder: 'Optional comment to include when forwarding',
      condition: { field: 'operation', value: ['forward_outlook'] },
      required: false,
    },
    {
      id: 'subject',
      title: 'Subject',
      type: 'short-input',
      placeholder: 'Email subject',
      condition: { field: 'operation', value: ['send_outlook', 'draft_outlook'] },
      required: true,
    },
    {
      id: 'body',
      title: 'Body',
      type: 'long-input',
      placeholder: 'Email content',
      condition: { field: 'operation', value: ['send_outlook', 'draft_outlook'] },
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
      condition: { field: 'operation', value: ['send_outlook', 'draft_outlook'] },
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
      condition: { field: 'operation', value: ['send_outlook', 'draft_outlook'] },
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
      condition: { field: 'operation', value: ['send_outlook', 'draft_outlook'] },
      mode: 'advanced',
      required: false,
    },
    // Advanced Settings - Threading
    {
      id: 'replyToMessageId',
      title: 'Reply to Message ID',
      type: 'short-input',
      placeholder: 'Message ID to reply to (for threading)',
      condition: { field: 'operation', value: ['send_outlook'] },
      mode: 'advanced',
      required: false,
    },
    {
      id: 'conversationId',
      title: 'Conversation ID',
      type: 'short-input',
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
      placeholder: 'CC recipients (comma-separated)',
      condition: { field: 'operation', value: ['send_outlook', 'draft_outlook'] },
      mode: 'advanced',
      required: false,
    },
    {
      id: 'bcc',
      title: 'BCC',
      type: 'short-input',
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
      canonicalParamId: 'folder',
      provider: 'outlook',
      serviceId: 'outlook',
      requiredScopes: ['Mail.ReadWrite', 'Mail.ReadBasic', 'Mail.Read'],
      placeholder: 'Select Outlook folder',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: 'read_outlook' },
    },
    // Manual folder input (advanced mode)
    {
      id: 'manualFolder',
      title: 'Folder',
      type: 'short-input',
      canonicalParamId: 'folder',
      placeholder: 'Enter Outlook folder name (e.g., INBOX, SENT, or custom folder)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'read_outlook' },
    },
    {
      id: 'maxResults',
      title: 'Number of Emails',
      type: 'short-input',
      placeholder: 'Number of emails to retrieve (default: 1, max: 10)',
      condition: { field: 'operation', value: 'read_outlook' },
    },
    {
      id: 'includeAttachments',
      title: 'Include Attachments',
      type: 'switch',
      condition: { field: 'operation', value: 'read_outlook' },
    },
    // Move Email Fields
    {
      id: 'moveMessageId',
      title: 'Message ID',
      type: 'short-input',
      placeholder: 'ID of the email to move',
      condition: { field: 'operation', value: 'move_outlook' },
      required: true,
    },
    // Destination folder selector (basic mode)
    {
      id: 'destinationFolder',
      title: 'Move To Folder',
      type: 'folder-selector',
      canonicalParamId: 'destinationId',
      provider: 'outlook',
      serviceId: 'outlook',
      requiredScopes: ['Mail.ReadWrite', 'Mail.ReadBasic', 'Mail.Read'],
      placeholder: 'Select destination folder',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: 'move_outlook' },
      required: true,
    },
    // Manual destination folder input (advanced mode)
    {
      id: 'manualDestinationFolder',
      title: 'Move To Folder',
      type: 'short-input',
      canonicalParamId: 'destinationId',
      placeholder: 'Enter folder ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'move_outlook' },
      required: true,
    },
    // Mark as Read/Unread, Delete - Message ID field
    {
      id: 'actionMessageId',
      title: 'Message ID',
      type: 'short-input',
      placeholder: 'ID of the email',
      condition: {
        field: 'operation',
        value: ['mark_read_outlook', 'mark_unread_outlook', 'delete_outlook'],
      },
      required: true,
    },
    // Copy Email - Message ID field
    {
      id: 'copyMessageId',
      title: 'Message ID',
      type: 'short-input',
      placeholder: 'ID of the email to copy',
      condition: { field: 'operation', value: 'copy_outlook' },
      required: true,
    },
    // Copy Email - Destination folder selector (basic mode)
    {
      id: 'copyDestinationFolder',
      title: 'Copy To Folder',
      type: 'folder-selector',
      canonicalParamId: 'copyDestinationId',
      provider: 'outlook',
      serviceId: 'outlook',
      requiredScopes: ['Mail.ReadWrite', 'Mail.ReadBasic', 'Mail.Read'],
      placeholder: 'Select destination folder',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: 'copy_outlook' },
      required: true,
    },
    // Copy Email - Manual destination folder input (advanced mode)
    {
      id: 'manualCopyDestinationFolder',
      title: 'Copy To Folder',
      type: 'short-input',
      canonicalParamId: 'copyDestinationId',
      placeholder: 'Enter folder ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'copy_outlook' },
      required: true,
    },
    ...getTrigger('outlook_poller').subBlocks,
  ],
  tools: {
    access: [
      'outlook_send',
      'outlook_draft',
      'outlook_read',
      'outlook_forward',
      'outlook_move',
      'outlook_mark_read',
      'outlook_mark_unread',
      'outlook_delete',
      'outlook_copy',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'send_outlook':
            return 'outlook_send'
          case 'read_outlook':
            return 'outlook_read'
          case 'draft_outlook':
            return 'outlook_draft'
          case 'forward_outlook':
            return 'outlook_forward'
          case 'move_outlook':
            return 'outlook_move'
          case 'mark_read_outlook':
            return 'outlook_mark_read'
          case 'mark_unread_outlook':
            return 'outlook_mark_unread'
          case 'delete_outlook':
            return 'outlook_delete'
          case 'copy_outlook':
            return 'outlook_copy'
          default:
            throw new Error(`Invalid Outlook operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          credential,
          folder,
          manualFolder,
          destinationFolder,
          manualDestinationFolder,
          moveMessageId,
          actionMessageId,
          copyMessageId,
          copyDestinationFolder,
          manualCopyDestinationFolder,
          ...rest
        } = params

        // Handle both selector and manual folder input
        const effectiveFolder = (folder || manualFolder || '').trim()

        if (rest.operation === 'read_outlook') {
          rest.folder = effectiveFolder || 'INBOX'
        }

        // Handle move operation
        if (rest.operation === 'move_outlook') {
          if (moveMessageId) {
            rest.messageId = moveMessageId
          }
          if (!rest.destinationId) {
            rest.destinationId = (destinationFolder || manualDestinationFolder || '').trim()
          }
        }

        if (
          ['mark_read_outlook', 'mark_unread_outlook', 'delete_outlook'].includes(rest.operation)
        ) {
          if (actionMessageId) {
            rest.messageId = actionMessageId
          }
        }

        if (rest.operation === 'copy_outlook') {
          if (copyMessageId) {
            rest.messageId = copyMessageId
          }
          // Handle copyDestinationId (from UI canonical param) or destinationId (from trigger)
          if (rest.copyDestinationId) {
            rest.destinationId = rest.copyDestinationId
            rest.copyDestinationId = undefined
          } else if (!rest.destinationId) {
            rest.destinationId = (copyDestinationFolder || manualCopyDestinationFolder || '').trim()
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
    credential: { type: 'string', description: 'Outlook access token' },
    // Send operation inputs
    to: { type: 'string', description: 'Recipient email address' },
    subject: { type: 'string', description: 'Email subject' },
    body: { type: 'string', description: 'Email content' },
    contentType: { type: 'string', description: 'Content type (Text or HTML)' },
    attachmentFiles: { type: 'json', description: 'Files to attach (UI upload)' },
    attachments: { type: 'json', description: 'Files to attach (UserFile array)' },
    // Forward operation inputs
    messageId: { type: 'string', description: 'Message ID to forward' },
    comment: { type: 'string', description: 'Optional comment for forwarding' },
    // Read operation inputs
    folder: { type: 'string', description: 'Email folder' },
    manualFolder: { type: 'string', description: 'Manual folder name' },
    maxResults: { type: 'number', description: 'Maximum emails' },
    includeAttachments: { type: 'boolean', description: 'Include email attachments' },
    // Move operation inputs
    moveMessageId: { type: 'string', description: 'Message ID to move' },
    destinationFolder: { type: 'string', description: 'Destination folder ID' },
    manualDestinationFolder: { type: 'string', description: 'Manual destination folder ID' },
    destinationId: { type: 'string', description: 'Destination folder ID for move' },
    // Action operation inputs
    actionMessageId: { type: 'string', description: 'Message ID for actions' },
    copyMessageId: { type: 'string', description: 'Message ID to copy' },
    copyDestinationFolder: { type: 'string', description: 'Copy destination folder ID' },
    manualCopyDestinationFolder: {
      type: 'string',
      description: 'Manual copy destination folder ID',
    },
    copyDestinationId: { type: 'string', description: 'Destination folder ID for copy' },
  },
  outputs: {
    // Common outputs
    message: { type: 'string', description: 'Response message' },
    results: { type: 'json', description: 'Operation results' },
    // Send operation specific outputs
    status: { type: 'string', description: 'Email send status (sent)' },
    timestamp: { type: 'string', description: 'Operation timestamp' },
    // Draft operation specific outputs
    messageId: { type: 'string', description: 'Draft message ID' },
    subject: { type: 'string', description: 'Draft email subject' },
    // Read operation specific outputs
    emailCount: { type: 'number', description: 'Number of emails retrieved' },
    emails: { type: 'json', description: 'Array of email objects' },
    emailId: { type: 'string', description: 'Individual email ID' },
    emailSubject: { type: 'string', description: 'Individual email subject' },
    bodyPreview: { type: 'string', description: 'Email body preview' },
    bodyContent: { type: 'string', description: 'Full email body content' },
    sender: { type: 'json', description: 'Email sender information' },
    from: { type: 'json', description: 'Email from information' },
    recipients: { type: 'json', description: 'Email recipients' },
    receivedDateTime: { type: 'string', description: 'Email received timestamp' },
    sentDateTime: { type: 'string', description: 'Email sent timestamp' },
    hasAttachments: { type: 'boolean', description: 'Whether email has attachments' },
    attachments: {
      type: 'json',
      description: 'Email attachments (if includeAttachments is enabled)',
    },
    isRead: { type: 'boolean', description: 'Whether email is read' },
    importance: { type: 'string', description: 'Email importance level' },
    // Trigger outputs
    email: { type: 'json', description: 'Email data from trigger' },
    rawEmail: { type: 'json', description: 'Complete raw email data from Microsoft Graph API' },
  },
  triggers: {
    enabled: true,
    available: ['outlook_poller'],
  },
}
