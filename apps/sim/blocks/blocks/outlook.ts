import { OutlookIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import { OutlookBlockDisplay } from '@/blocks/blocks/outlook.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { OutlookResponse } from '@/tools/outlook/types'
import { getTrigger } from '@/triggers'

export const OutlookBlock: BlockConfig<OutlookResponse> = {
  ...OutlookBlockDisplay,
  authMode: AuthMode.OAuth,
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
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      serviceId: 'outlook',
      requiredScopes: getScopesForService('outlook'),
      placeholder: 'Select Microsoft account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Microsoft Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
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
      id: 'attachmentReference',
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
      id: 'folderSelector',
      title: 'Folder',
      type: 'folder-selector',
      canonicalParamId: 'folder',
      serviceId: 'outlook',
      selectorKey: 'outlook.folders',
      requiredScopes: getScopesForService('outlook'),
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
      dependsOn: ['credential'],
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
      serviceId: 'outlook',
      selectorKey: 'outlook.folders',
      requiredScopes: getScopesForService('outlook'),
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
      dependsOn: ['credential'],
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
      serviceId: 'outlook',
      selectorKey: 'outlook.folders',
      requiredScopes: getScopesForService('outlook'),
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
      dependsOn: ['credential'],
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
          oauthCredential,
          folder,
          destinationId,
          copyDestinationId,
          attachments,
          moveMessageId,
          actionMessageId,
          copyMessageId,
          ...rest
        } = params

        // folder is already the canonical param - use it directly
        const effectiveFolder = folder ? String(folder).trim() : ''

        // Normalize file attachments from the canonical attachments param
        const normalizedAttachments = normalizeFileInput(attachments)
        if (normalizedAttachments) {
          rest.attachments = normalizedAttachments
        }

        if (rest.operation === 'read_outlook') {
          rest.folder = effectiveFolder || 'INBOX'
        }

        // Handle move operation
        if (rest.operation === 'move_outlook') {
          if (moveMessageId) {
            rest.messageId = moveMessageId
          }
          // destinationId is already the canonical param
          const effectiveDestinationId = destinationId ? String(destinationId).trim() : ''
          if (effectiveDestinationId) {
            rest.destinationId = effectiveDestinationId
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
          // copyDestinationId is the canonical param - map it to destinationId for the tool
          const effectiveCopyDestinationId = copyDestinationId
            ? String(copyDestinationId).trim()
            : ''
          if (effectiveCopyDestinationId) {
            rest.destinationId = effectiveCopyDestinationId
          }
        }

        return {
          ...rest,
          oauthCredential,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Outlook access token' },
    // Send operation inputs
    to: { type: 'string', description: 'Recipient email address' },
    subject: { type: 'string', description: 'Email subject' },
    body: { type: 'string', description: 'Email content' },
    contentType: { type: 'string', description: 'Content type (Text or HTML)' },
    attachments: { type: 'array', description: 'Files to attach (canonical param)' },
    // Forward operation inputs
    messageId: { type: 'string', description: 'Message ID to forward' },
    comment: { type: 'string', description: 'Optional comment for forwarding' },
    // Read operation inputs
    folder: { type: 'string', description: 'Email folder (canonical param)' },
    maxResults: { type: 'number', description: 'Maximum emails' },
    includeAttachments: { type: 'boolean', description: 'Include email attachments' },
    // Move operation inputs
    moveMessageId: { type: 'string', description: 'Message ID to move' },
    destinationId: { type: 'string', description: 'Destination folder ID (canonical param)' },
    // Action operation inputs
    actionMessageId: { type: 'string', description: 'Message ID for actions' },
    copyMessageId: { type: 'string', description: 'Message ID to copy' },
    copyDestinationId: {
      type: 'string',
      description: 'Destination folder ID for copy (canonical param)',
    },
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
      type: 'file[]',
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

export const OutlookBlockMeta = {
  tags: ['microsoft-365', 'messaging', 'automation'],
  url: 'https://www.microsoft.com/microsoft-365/outlook',
  templates: [
    {
      icon: OutlookIcon,
      title: 'Outlook auto-responder',
      prompt:
        'Build a workflow that monitors my Outlook inbox, drafts a contextual reply for every email that needs a response using my recent threads as tone reference, and saves each reply as an Outlook draft for me to review and send.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'communication', 'automation'],
    },
    {
      icon: OutlookIcon,
      title: 'Outlook customer escalation to Zendesk',
      prompt:
        'Create a workflow that reads new Outlook emails from customers, classifies whether each one is a support issue, and when it is, creates a Zendesk ticket with the email body, attachments, and contact details, then replies from Outlook with the ticket number.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'communication', 'automation'],
      alsoIntegrations: ['zendesk'],
    },
    {
      icon: OutlookIcon,
      title: 'Outlook executive triage',
      prompt:
        'Build a scheduled workflow that scans Outlook every hour, ranks new emails by urgency, summarizes the top items, and posts a prioritized digest to a Slack channel so executives can act without opening the inbox.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['founder', 'communication', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: OutlookIcon,
      title: 'Outlook invoice extractor',
      prompt:
        'Build a workflow that monitors Outlook for invoice attachments, extracts vendor, amount, due date, and line items from each PDF, and logs the results to a tracking table while moving the original email to an Invoices folder.',
      modules: ['files', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'automation'],
    },
    {
      icon: OutlookIcon,
      title: 'Outlook follow-up reminder',
      prompt:
        'Create a workflow that scans Outlook for sent emails awaiting a reply older than three business days, drafts a polite follow-up email per thread, and saves each one as a draft in Outlook ready to send.',
      modules: ['agent', 'scheduled', 'workflows'],
      category: 'productivity',
      tags: ['sales', 'communication', 'automation'],
    },
    {
      icon: OutlookIcon,
      title: 'Outlook to JSM ticket router',
      prompt:
        'Build a workflow that reads support requests arriving in a shared Outlook mailbox, classifies the request type, and creates a Jira Service Management request in the correct service desk with the right request type, then replies from Outlook with the JSM portal link.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation', 'enterprise'],
      alsoIntegrations: ['jira_service_management'],
    },
    {
      icon: OutlookIcon,
      title: 'Outlook newsletter clipper',
      prompt:
        'Create a workflow that reads newsletters arriving in Outlook, summarizes each one into key takeaways, and appends the digest to a daily Notion page so the inbox stays clean and the insights stay searchable.',
      modules: ['agent', 'scheduled', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'research', 'content'],
      alsoIntegrations: ['notion'],
    },
    {
      icon: OutlookIcon,
      title: 'Outlook contract clause flagger',
      prompt:
        'Build a workflow that scans Outlook for inbound contracts and amendments, extracts key clauses (payment terms, liability, termination, renewal), flags deviations from my standard terms, and replies internally with a summary and red-flag list.',
      modules: ['files', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'analysis', 'automation'],
    },
  ],
  skills: [
    {
      name: 'send-email',
      description: 'Compose and send an Outlook email to one or more recipients.',
      content:
        '# Send Email\n\nSend a message from the connected Outlook account.\n\n## Steps\n1. Gather the recipients, subject, and the body content.\n2. Write a clear subject and a concise, well-structured body.\n3. Run Send Email with the recipients, subject, and body. Use Draft Email instead when the message should be reviewed before sending.\n\n## Output\nConfirm the email was sent, listing recipients and subject. If drafted, note that it awaits review.',
    },
    {
      name: 'triage-inbox',
      description: 'Read recent Outlook emails and summarize which ones need a reply or action.',
      content:
        '# Triage Inbox\n\nTurn a noisy Outlook inbox into a short action list.\n\n## Steps\n1. Run Read Email to pull recent unread messages.\n2. Classify each as needs reply, needs action, FYI, or ignore.\n3. For handled messages, run Mark as Read; leave items that still need a reply unread.\n\n## Output\nA prioritized list of emails that need attention, each with sender, subject, and the suggested next action.',
    },
    {
      name: 'forward-with-context',
      description: 'Forward an Outlook email to the right person with an added note.',
      content:
        '# Forward with Context\n\nRoute an email to the correct owner with a short explanation.\n\n## Steps\n1. Read the target email to capture its content with Read Email.\n2. Identify the correct recipient for the topic.\n3. Run Forward Email to that recipient, adding a brief note on why it is being forwarded and what is needed.\n\n## Output\nConfirm the email was forwarded, to whom, and the note that was added.',
    },
    {
      name: 'file-email-to-folder',
      description: 'Move an Outlook email to the appropriate folder to keep the inbox clean.',
      content:
        '# File Email to Folder\n\nOrganize the inbox by moving a message into the right folder.\n\n## Steps\n1. Identify the email and the destination folder.\n2. Run Move Email to relocate the message.\n3. Optionally run Mark as Read so it does not linger as unread.\n\n## Output\nConfirm the email moved, naming the source and destination folders.',
    },
  ],
} as const satisfies BlockMeta
