import { AgentMailIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

export const AgentMailBlock: BlockConfig = {
  type: 'agentmail',
  name: 'AgentMail',
  description: 'Manage email inboxes, threads, and messages with AgentMail',
  longDescription:
    'Integrate AgentMail into your workflow. Create and manage email inboxes, send and receive messages, reply to threads, manage drafts, and organize threads with labels. Requires API Key.',
  docsLink: 'https://docs.sim.ai/tools/agentmail',
  category: 'tools',
  integrationType: IntegrationType.Email,
  tags: ['messaging'],
  bgColor: '#000000',
  icon: AgentMailIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Send Message', id: 'send_message' },
        { label: 'Reply to Message', id: 'reply_message' },
        { label: 'Forward Message', id: 'forward_message' },
        { label: 'List Threads', id: 'list_threads' },
        { label: 'Get Thread', id: 'get_thread' },
        { label: 'Update Thread Labels', id: 'update_thread' },
        { label: 'Delete Thread', id: 'delete_thread' },
        { label: 'List Messages', id: 'list_messages' },
        { label: 'Get Message', id: 'get_message' },
        { label: 'Update Message Labels', id: 'update_message' },
        { label: 'Create Draft', id: 'create_draft' },
        { label: 'List Drafts', id: 'list_drafts' },
        { label: 'Get Draft', id: 'get_draft' },
        { label: 'Update Draft', id: 'update_draft' },
        { label: 'Delete Draft', id: 'delete_draft' },
        { label: 'Send Draft', id: 'send_draft' },
        { label: 'Create Inbox', id: 'create_inbox' },
        { label: 'List Inboxes', id: 'list_inboxes' },
        { label: 'Get Inbox', id: 'get_inbox' },
        { label: 'Update Inbox', id: 'update_inbox' },
        { label: 'Delete Inbox', id: 'delete_inbox' },
      ],
      value: () => 'send_message',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your AgentMail API key',
      required: true,
      password: true,
    },

    // Send Message fields
    {
      id: 'inboxId',
      title: 'Inbox ID',
      type: 'short-input',
      placeholder: 'Inbox ID',
      condition: {
        field: 'operation',
        value: [
          'send_message',
          'reply_message',
          'forward_message',
          'list_threads',
          'get_thread',
          'update_thread',
          'delete_thread',
          'list_messages',
          'get_message',
          'update_message',
          'create_draft',
          'list_drafts',
          'get_draft',
          'update_draft',
          'delete_draft',
          'send_draft',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'send_message',
          'reply_message',
          'forward_message',
          'list_threads',
          'get_thread',
          'update_thread',
          'delete_thread',
          'list_messages',
          'get_message',
          'update_message',
          'create_draft',
          'list_drafts',
          'get_draft',
          'update_draft',
          'delete_draft',
          'send_draft',
        ],
      },
    },
    {
      id: 'to',
      title: 'To',
      type: 'short-input',
      placeholder: 'recipient@example.com',
      condition: {
        field: 'operation',
        value: ['send_message', 'forward_message', 'create_draft', 'update_draft'],
      },
      required: { field: 'operation', value: ['send_message', 'forward_message'] },
    },
    {
      id: 'subject',
      title: 'Subject',
      type: 'short-input',
      placeholder: 'Email subject',
      condition: {
        field: 'operation',
        value: ['send_message', 'forward_message', 'create_draft', 'update_draft'],
      },
      required: { field: 'operation', value: 'send_message' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a compelling email subject line based on the description. Keep it concise. Return ONLY the subject line.',
        placeholder: 'Describe the email topic...',
      },
    },
    {
      id: 'text',
      title: 'Text',
      type: 'long-input',
      placeholder: 'Plain text email body',
      condition: {
        field: 'operation',
        value: ['send_message', 'reply_message', 'forward_message', 'create_draft', 'update_draft'],
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate email content based on the description. Use clear formatting with short paragraphs. Return ONLY the email body.',
        placeholder: 'Describe the email content...',
      },
    },
    {
      id: 'html',
      title: 'HTML',
      type: 'long-input',
      placeholder: '<p>HTML email body</p>',
      condition: {
        field: 'operation',
        value: ['send_message', 'reply_message', 'forward_message', 'create_draft', 'update_draft'],
      },
      mode: 'advanced',
    },
    {
      id: 'cc',
      title: 'CC',
      type: 'short-input',
      placeholder: 'cc@example.com',
      condition: {
        field: 'operation',
        value: ['send_message', 'reply_message', 'forward_message', 'create_draft', 'update_draft'],
      },
      mode: 'advanced',
    },
    {
      id: 'bcc',
      title: 'BCC',
      type: 'short-input',
      placeholder: 'bcc@example.com',
      condition: {
        field: 'operation',
        value: ['send_message', 'reply_message', 'forward_message', 'create_draft', 'update_draft'],
      },
      mode: 'advanced',
    },

    // Reply to Message fields
    {
      id: 'replyMessageId',
      title: 'Message ID to Reply To',
      type: 'short-input',
      placeholder: 'Message ID',
      condition: { field: 'operation', value: 'reply_message' },
      required: { field: 'operation', value: 'reply_message' },
    },
    {
      id: 'replyTo',
      title: 'Override To',
      type: 'short-input',
      placeholder: 'Override recipient (optional)',
      condition: { field: 'operation', value: 'reply_message' },
      mode: 'advanced',
    },
    {
      id: 'replyAll',
      title: 'Reply All',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'reply_message' },
      mode: 'advanced',
    },

    // Thread ID fields (shared across thread operations)
    {
      id: 'threadId',
      title: 'Thread ID',
      type: 'short-input',
      placeholder: 'Thread ID',
      condition: {
        field: 'operation',
        value: ['get_thread', 'update_thread', 'delete_thread'],
      },
      required: {
        field: 'operation',
        value: ['get_thread', 'update_thread', 'delete_thread'],
      },
    },

    // Update Thread Labels fields
    {
      id: 'addLabels',
      title: 'Add Labels',
      type: 'short-input',
      placeholder: 'important, follow-up',
      condition: { field: 'operation', value: 'update_thread' },
    },
    {
      id: 'removeLabels',
      title: 'Remove Labels',
      type: 'short-input',
      placeholder: 'inbox, unread',
      condition: { field: 'operation', value: 'update_thread' },
    },

    // Delete Thread fields
    {
      id: 'permanent',
      title: 'Permanent Delete',
      type: 'dropdown',
      options: [
        { label: 'No (move to trash)', id: 'false' },
        { label: 'Yes (permanent)', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'delete_thread' },
      mode: 'advanced',
    },

    // Forward Message fields
    {
      id: 'forwardMessageId',
      title: 'Message ID to Forward',
      type: 'short-input',
      placeholder: 'Message ID',
      condition: { field: 'operation', value: 'forward_message' },
      required: { field: 'operation', value: 'forward_message' },
    },

    // Update Message Labels fields
    {
      id: 'updateMessageId',
      title: 'Message ID',
      type: 'short-input',
      placeholder: 'Message ID',
      condition: { field: 'operation', value: 'update_message' },
      required: { field: 'operation', value: 'update_message' },
    },
    {
      id: 'msgAddLabels',
      title: 'Add Labels',
      type: 'short-input',
      placeholder: 'important, follow-up',
      condition: { field: 'operation', value: 'update_message' },
    },
    {
      id: 'msgRemoveLabels',
      title: 'Remove Labels',
      type: 'short-input',
      placeholder: 'inbox, unread',
      condition: { field: 'operation', value: 'update_message' },
    },

    // Get Message fields
    {
      id: 'messageId',
      title: 'Message ID',
      type: 'short-input',
      placeholder: 'Message ID',
      condition: { field: 'operation', value: 'get_message' },
      required: { field: 'operation', value: 'get_message' },
    },

    // Draft ID fields (shared across draft operations)
    {
      id: 'draftId',
      title: 'Draft ID',
      type: 'short-input',
      placeholder: 'Draft ID',
      condition: {
        field: 'operation',
        value: ['get_draft', 'update_draft', 'delete_draft', 'send_draft'],
      },
      required: {
        field: 'operation',
        value: ['get_draft', 'update_draft', 'delete_draft', 'send_draft'],
      },
    },

    // Create/Update Draft fields
    {
      id: 'draftInReplyTo',
      title: 'In Reply To',
      type: 'short-input',
      placeholder: 'Message ID this draft replies to',
      condition: { field: 'operation', value: 'create_draft' },
      mode: 'advanced',
    },
    {
      id: 'sendAt',
      title: 'Schedule Send',
      type: 'short-input',
      placeholder: 'ISO 8601 timestamp to schedule sending',
      condition: { field: 'operation', value: ['create_draft', 'update_draft'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt: 'Generate an ISO 8601 timestamp. Return ONLY the timestamp string.',
        placeholder: 'Describe when to send (e.g., "tomorrow at 9am")...',
      },
    },

    // Create Inbox fields
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'Optional username for email address',
      condition: { field: 'operation', value: 'create_inbox' },
    },
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'Optional domain for email address',
      condition: { field: 'operation', value: 'create_inbox' },
      mode: 'advanced',
    },
    {
      id: 'displayName',
      title: 'Display Name',
      type: 'short-input',
      placeholder: 'Inbox display name',
      condition: { field: 'operation', value: ['create_inbox', 'update_inbox'] },
      required: { field: 'operation', value: 'update_inbox' },
    },

    // Inbox ID for get/update/delete inbox
    {
      id: 'inboxIdParam',
      title: 'Inbox ID',
      type: 'short-input',
      placeholder: 'Inbox ID',
      condition: {
        field: 'operation',
        value: ['get_inbox', 'update_inbox', 'delete_inbox'],
      },
      required: {
        field: 'operation',
        value: ['get_inbox', 'update_inbox', 'delete_inbox'],
      },
    },

    // Pagination fields (advanced)
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Max results to return',
      condition: {
        field: 'operation',
        value: ['list_inboxes', 'list_threads', 'list_messages', 'list_drafts'],
      },
      mode: 'advanced',
    },
    {
      id: 'pageToken',
      title: 'Page Token',
      type: 'short-input',
      placeholder: 'Pagination token',
      condition: {
        field: 'operation',
        value: ['list_inboxes', 'list_threads', 'list_messages', 'list_drafts'],
      },
      mode: 'advanced',
    },

    // List Threads filters (advanced)
    {
      id: 'labels',
      title: 'Labels Filter',
      type: 'short-input',
      placeholder: 'Filter by labels (comma-separated)',
      condition: { field: 'operation', value: 'list_threads' },
      mode: 'advanced',
    },
    {
      id: 'before',
      title: 'Before',
      type: 'short-input',
      placeholder: 'Filter threads before this date',
      condition: { field: 'operation', value: 'list_threads' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt: 'Generate an ISO 8601 timestamp. Return ONLY the timestamp string.',
        placeholder: 'Describe the date (e.g., "yesterday")...',
      },
    },
    {
      id: 'after',
      title: 'After',
      type: 'short-input',
      placeholder: 'Filter threads after this date',
      condition: { field: 'operation', value: 'list_threads' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt: 'Generate an ISO 8601 timestamp. Return ONLY the timestamp string.',
        placeholder: 'Describe the date (e.g., "last week")...',
      },
    },
  ],

  tools: {
    access: [
      'agentmail_create_draft',
      'agentmail_create_inbox',
      'agentmail_delete_draft',
      'agentmail_delete_inbox',
      'agentmail_delete_thread',
      'agentmail_forward_message',
      'agentmail_get_draft',
      'agentmail_get_inbox',
      'agentmail_get_message',
      'agentmail_get_thread',
      'agentmail_list_drafts',
      'agentmail_list_inboxes',
      'agentmail_list_messages',
      'agentmail_list_threads',
      'agentmail_reply_message',
      'agentmail_send_draft',
      'agentmail_send_message',
      'agentmail_update_draft',
      'agentmail_update_inbox',
      'agentmail_update_message',
      'agentmail_update_thread',
    ],
    config: {
      tool: (params) => `agentmail_${params.operation || 'send_message'}`,
      params: (params) => {
        const {
          operation,
          inboxIdParam,
          permanent,
          replyMessageId,
          replyTo,
          replyAll,
          forwardMessageId,
          updateMessageId,
          msgAddLabels,
          msgRemoveLabels,
          addLabels,
          removeLabels,
          draftInReplyTo,
          ...rest
        } = params

        if (['get_inbox', 'update_inbox', 'delete_inbox'].includes(operation) && inboxIdParam) {
          rest.inboxId = inboxIdParam
        }

        if (operation === 'delete_thread' && permanent !== undefined) {
          rest.permanent = permanent === 'true'
        }

        if (operation === 'reply_message' && replyAll !== undefined) {
          rest.replyAll = replyAll === 'true'
        }

        if (operation === 'reply_message' && replyMessageId) {
          rest.messageId = replyMessageId
        }

        if (operation === 'reply_message' && replyTo) {
          rest.to = replyTo
        } else if (operation === 'reply_message') {
          rest.to = undefined
        }

        if (operation === 'forward_message' && forwardMessageId) {
          rest.messageId = forwardMessageId
        }

        if (operation === 'update_message' && updateMessageId) {
          rest.messageId = updateMessageId
        }

        if (operation === 'update_message' && msgAddLabels) {
          rest.addLabels = msgAddLabels
        }

        if (operation === 'update_message' && msgRemoveLabels) {
          rest.removeLabels = msgRemoveLabels
        }

        if (operation === 'update_thread' && addLabels) {
          rest.addLabels = addLabels
        }

        if (operation === 'update_thread' && removeLabels) {
          rest.removeLabels = removeLabels
        }

        if (operation === 'create_draft' && draftInReplyTo) {
          rest.inReplyTo = draftInReplyTo
        }

        if (rest.limit) {
          rest.limit = Number(rest.limit)
        }

        return rest
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'AgentMail API key' },
    inboxId: { type: 'string', description: 'Inbox ID' },
    inboxIdParam: {
      type: 'string',
      description: 'Inbox ID for get/update/delete inbox operations',
    },
    to: { type: 'string', description: 'Recipient email address' },
    subject: { type: 'string', description: 'Email subject' },
    text: { type: 'string', description: 'Plain text email body' },
    html: { type: 'string', description: 'HTML email body' },
    cc: { type: 'string', description: 'CC email addresses' },
    bcc: { type: 'string', description: 'BCC email addresses' },
    replyMessageId: { type: 'string', description: 'Message ID to reply to' },
    replyTo: { type: 'string', description: 'Override recipient for reply' },
    replyAll: { type: 'string', description: 'Reply to all recipients' },
    forwardMessageId: { type: 'string', description: 'Message ID to forward' },
    updateMessageId: { type: 'string', description: 'Message ID to update labels on' },
    msgAddLabels: { type: 'string', description: 'Labels to add to message' },
    msgRemoveLabels: { type: 'string', description: 'Labels to remove from message' },
    threadId: { type: 'string', description: 'Thread ID' },
    addLabels: { type: 'string', description: 'Labels to add to thread (comma-separated)' },
    removeLabels: { type: 'string', description: 'Labels to remove from thread (comma-separated)' },
    permanent: { type: 'string', description: 'Whether to permanently delete' },
    messageId: { type: 'string', description: 'Message ID' },
    draftId: { type: 'string', description: 'Draft ID' },
    draftInReplyTo: { type: 'string', description: 'Message ID this draft replies to' },
    sendAt: { type: 'string', description: 'ISO 8601 timestamp to schedule sending' },
    username: { type: 'string', description: 'Username for new inbox' },
    domain: { type: 'string', description: 'Domain for new inbox' },
    displayName: { type: 'string', description: 'Display name for inbox' },
    limit: { type: 'string', description: 'Max results to return' },
    pageToken: { type: 'string', description: 'Pagination token' },
    labels: { type: 'string', description: 'Labels filter for threads' },
    before: { type: 'string', description: 'Filter threads before this date' },
    after: { type: 'string', description: 'Filter threads after this date' },
  },

  outputs: {
    inboxId: { type: 'string', description: 'Inbox ID' },
    email: { type: 'string', description: 'Inbox email address' },
    displayName: { type: 'string', description: 'Inbox display name' },
    threadId: { type: 'string', description: 'Thread ID' },
    messageId: { type: 'string', description: 'Message ID' },
    draftId: { type: 'string', description: 'Draft ID' },
    subject: { type: 'string', description: 'Email subject' },
    to: { type: 'string', description: 'Recipient email address' },
    from: { type: 'string', description: 'Sender email address' },
    text: { type: 'string', description: 'Plain text content' },
    html: { type: 'string', description: 'HTML content' },
    preview: { type: 'string', description: 'Message or draft preview text' },
    senders: { type: 'json', description: 'List of sender email addresses' },
    recipients: { type: 'json', description: 'List of recipient email addresses' },
    labels: { type: 'json', description: 'Thread or draft labels' },
    messages: { type: 'json', description: 'List of messages' },
    threads: { type: 'json', description: 'List of threads' },
    inboxes: { type: 'json', description: 'List of inboxes' },
    drafts: { type: 'json', description: 'List of drafts' },
    messageCount: { type: 'number', description: 'Number of messages in thread' },
    count: { type: 'number', description: 'Total number of results' },
    nextPageToken: { type: 'string', description: 'Token for next page of results' },
    deleted: { type: 'boolean', description: 'Whether the resource was deleted' },
    sendStatus: { type: 'string', description: 'Draft send status' },
    sendAt: { type: 'string', description: 'Scheduled send time' },
    inReplyTo: { type: 'string', description: 'Message ID this draft replies to' },
    createdAt: { type: 'string', description: 'Creation timestamp' },
    updatedAt: { type: 'string', description: 'Last updated timestamp' },
  },
}
