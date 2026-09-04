import { MailtrapIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

export const MailtrapBlock: BlockConfig = {
  type: 'mailtrap',
  name: 'Mailtrap',
  description: 'Send emails and manage contacts with Mailtrap.',
  longDescription:
    'Integrate Mailtrap into your workflow. Send emails through the transactional, bulk, or sandbox stream, manage contacts and contact lists, and search the email logs. The log filters cover the common cases with fixed operators; negation, event, open/click count, and IP or domain filters are not exposed. Requires a Mailtrap API token.',
  docsLink: 'https://docs.sim.ai/integrations/mailtrap',
  category: 'tools',
  integrationType: IntegrationType.Email,
  bgColor: '#1A2E44',
  icon: MailtrapIcon,
  authMode: AuthMode.ApiKey,

  canvasPresentation: {
    defaultTitle: 'Mailtrap',
    sentences: {
      byOperation: {
        send_email: [
          { text: 'Send', field: 'subject', core: true },
          { text: 'to', field: 'to', core: true },
          { text: 'via', field: 'stream' },
        ],
        create_contact: [{ text: 'Create contact', field: 'email', core: true }],
        get_contact: [{ text: 'Read contact', field: 'contactIdentifier', core: true }],
        update_contact: [{ text: 'Update contact', field: 'contactIdentifier', core: true }],
        delete_contact: [{ text: 'Delete contact', field: 'contactIdentifier', core: true }],
        list_contact_lists: ['List contact lists'],
        create_contact_list: [{ text: 'Create contact list', field: 'name', core: true }],
        get_contact_list: [{ text: 'Read contact list', field: 'listId', core: true }],
        update_contact_list: [{ text: 'Rename contact list', field: 'listId', core: true }],
        delete_contact_list: [{ text: 'Delete contact list', field: 'listId', core: true }],
        list_email_logs: [
          'List email logs',
          { text: 'to', field: 'logsTo' },
          { text: ', status', field: 'logsStatus' },
        ],
        get_email_log: [{ text: 'Read email log', field: 'messageId', core: true }],
      },
    },
  },

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Send Email', id: 'send_email' },
        { label: 'Create Contact', id: 'create_contact' },
        { label: 'Get Contact', id: 'get_contact' },
        { label: 'Update Contact', id: 'update_contact' },
        { label: 'Delete Contact', id: 'delete_contact' },
        { label: 'List Contact Lists', id: 'list_contact_lists' },
        { label: 'Create Contact List', id: 'create_contact_list' },
        { label: 'Get Contact List', id: 'get_contact_list' },
        { label: 'Update Contact List', id: 'update_contact_list' },
        { label: 'Delete Contact List', id: 'delete_contact_list' },
        { label: 'List Email Logs', id: 'list_email_logs' },
        { label: 'Get Email Log', id: 'get_email_log' },
      ],
      value: () => 'send_email',
    },
    {
      id: 'apiToken',
      title: 'Mailtrap API Token',
      type: 'short-input',
      placeholder: 'Your Mailtrap API token',
      password: true,
      required: true,
    },

    {
      id: 'stream',
      title: 'Sending Stream',
      type: 'dropdown',
      options: [
        { label: 'Transactional', id: 'transactional' },
        { label: 'Bulk', id: 'bulk' },
        { label: 'Sandbox (Testing)', id: 'sandbox' },
      ],
      value: () => 'transactional',
      condition: { field: 'operation', value: 'send_email' },
    },
    {
      id: 'sandboxId',
      title: 'Sandbox ID',
      type: 'short-input',
      placeholder: 'e.g. 1234567',
      condition: {
        field: 'operation',
        value: 'send_email',
        and: { field: 'stream', value: 'sandbox' },
      },
      required: {
        field: 'operation',
        value: 'send_email',
        and: { field: 'stream', value: 'sandbox' },
      },
    },
    {
      id: 'from',
      title: 'From',
      type: 'short-input',
      placeholder: 'sender@yourdomain.com or Acme Support <sender@yourdomain.com>',
      condition: { field: 'operation', value: 'send_email' },
      required: { field: 'operation', value: 'send_email' },
    },
    {
      id: 'to',
      title: 'To',
      canvasNoun: 'a recipient',
      type: 'short-input',
      placeholder: 'recipient@example.com, Second Name <second@example.com>',
      condition: { field: 'operation', value: 'send_email' },
    },
    {
      id: 'subject',
      title: 'Subject',
      type: 'short-input',
      placeholder: 'Email subject',
      condition: { field: 'operation', value: 'send_email' },
      required: { field: 'operation', value: 'send_email' },
      wandConfig: {
        enabled: true,
        prompt:
          "Generate a concise email subject line based on the user's description. Keep it under 60 characters and avoid spam trigger words. Return ONLY the subject line - no explanations.",
        placeholder: 'Describe the email topic...',
      },
    },
    {
      id: 'text',
      title: 'Text Body',
      type: 'long-input',
      placeholder: 'Plain text email body',
      condition: { field: 'operation', value: 'send_email' },
      wandConfig: {
        enabled: true,
        prompt:
          "Generate a plain text email body based on the user's description. Use short paragraphs and include a greeting and sign-off. Return ONLY the email body - no explanations.",
        placeholder: 'Describe the email content...',
      },
    },
    {
      id: 'html',
      title: 'HTML Body',
      type: 'code',
      placeholder: '<html><body>HTML email body</body></html>',
      condition: { field: 'operation', value: 'send_email' },
      mode: 'advanced',
    },
    {
      id: 'cc',
      title: 'CC',
      type: 'short-input',
      placeholder: 'cc@example.com, Name <cc2@example.com>',
      condition: { field: 'operation', value: 'send_email' },
      mode: 'advanced',
    },
    {
      id: 'bcc',
      title: 'BCC',
      type: 'short-input',
      placeholder: 'bcc@example.com, Name <bcc2@example.com>',
      condition: { field: 'operation', value: 'send_email' },
      mode: 'advanced',
    },
    {
      id: 'replyTo',
      title: 'Reply To',
      type: 'short-input',
      placeholder: 'reply@example.com or Name <reply@example.com>',
      condition: { field: 'operation', value: 'send_email' },
      mode: 'advanced',
    },
    {
      id: 'category',
      title: 'Category',
      type: 'short-input',
      placeholder: 'welcome',
      condition: { field: 'operation', value: 'send_email' },
      mode: 'advanced',
    },
    {
      id: 'customVariables',
      title: 'Custom Variables',
      type: 'code',
      language: 'json',
      placeholder: '{"user_id": "12345"}',
      condition: { field: 'operation', value: 'send_email' },
      mode: 'advanced',
      generationType: 'json-object',
    },
    {
      id: 'emailHeaders',
      title: 'Custom Headers',
      type: 'code',
      language: 'json',
      placeholder: '{"X-Campaign-ID": "CAMP-123"}',
      condition: { field: 'operation', value: 'send_email' },
      mode: 'advanced',
      generationType: 'json-object',
    },
    {
      id: 'templateUuid',
      title: 'Template UUID',
      type: 'short-input',
      placeholder: 'b81aabcd-1a1e-41cf-91b6-eca0254b3d96',
      condition: { field: 'operation', value: 'send_email' },
      mode: 'advanced',
    },
    {
      id: 'templateVariables',
      title: 'Template Variables',
      type: 'code',
      language: 'json',
      placeholder: '{"user_name": "John"}',
      condition: { field: 'operation', value: 'send_email' },
      mode: 'advanced',
      generationType: 'json-object',
    },

    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'contact@example.com',
      condition: { field: 'operation', value: ['create_contact', 'update_contact'] },
      required: true,
    },
    {
      id: 'contactIdentifier',
      title: 'Contact ID or Email',
      type: 'short-input',
      placeholder: 'Contact UUID or email address',
      condition: {
        field: 'operation',
        value: ['get_contact', 'update_contact', 'delete_contact'],
      },
      required: {
        field: 'operation',
        value: ['get_contact', 'update_contact', 'delete_contact'],
      },
    },
    {
      id: 'fields',
      title: 'Fields',
      type: 'code',
      language: 'json',
      placeholder: '{"first_name": "John", "last_name": "Smith"}',
      condition: { field: 'operation', value: ['create_contact', 'update_contact'] },
      generationType: 'json-object',
    },
    {
      id: 'listIds',
      title: 'List IDs',
      type: 'short-input',
      placeholder: '1, 2, 3',
      condition: { field: 'operation', value: 'create_contact' },
    },
    {
      id: 'listIdsIncluded',
      title: 'Add to List IDs',
      type: 'short-input',
      placeholder: '1, 2, 3',
      condition: { field: 'operation', value: 'update_contact' },
      mode: 'advanced',
    },
    {
      id: 'listIdsExcluded',
      title: 'Remove from List IDs',
      type: 'short-input',
      placeholder: '4, 5',
      condition: { field: 'operation', value: 'update_contact' },
      mode: 'advanced',
    },
    {
      id: 'unsubscribed',
      title: 'Unsubscribed',
      type: 'dropdown',
      options: [
        { label: 'Use Default', id: '' },
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_contact' },
      mode: 'advanced',
    },

    {
      id: 'search',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Filter lists by name prefix',
      condition: { field: 'operation', value: 'list_contact_lists' },
      mode: 'advanced',
    },
    {
      id: 'name',
      title: 'List Name',
      type: 'short-input',
      placeholder: 'Customers',
      condition: { field: 'operation', value: ['create_contact_list', 'update_contact_list'] },
      required: { field: 'operation', value: ['create_contact_list', 'update_contact_list'] },
    },
    {
      id: 'listId',
      title: 'List ID',
      type: 'short-input',
      placeholder: '26730',
      condition: {
        field: 'operation',
        value: ['get_contact_list', 'update_contact_list', 'delete_contact_list'],
      },
      required: {
        field: 'operation',
        value: ['get_contact_list', 'update_contact_list', 'delete_contact_list'],
      },
    },

    {
      id: 'messageId',
      title: 'Message ID',
      type: 'short-input',
      placeholder: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      condition: { field: 'operation', value: 'get_email_log' },
      required: { field: 'operation', value: 'get_email_log' },
    },
    {
      id: 'sentAfter',
      title: 'Sent After',
      type: 'short-input',
      placeholder: '2025-01-01T00:00:00Z',
      condition: { field: 'operation', value: 'list_email_logs' },
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt:
          'Generate an ISO 8601 timestamp for the start of a date range. Return ONLY the timestamp - no explanations.',
        placeholder: 'Describe the start of the range...',
      },
    },
    {
      id: 'sentBefore',
      title: 'Sent Before',
      type: 'short-input',
      placeholder: '2025-01-31T23:59:59Z',
      condition: { field: 'operation', value: 'list_email_logs' },
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt:
          'Generate an ISO 8601 timestamp for the end of a date range. Return ONLY the timestamp - no explanations.',
        placeholder: 'Describe the end of the range...',
      },
    },
    {
      id: 'logsTo',
      title: 'Recipient',
      type: 'short-input',
      placeholder: 'recipient@example.com',
      condition: { field: 'operation', value: 'list_email_logs' },
    },
    {
      id: 'logsFrom',
      title: 'Sender',
      type: 'short-input',
      placeholder: 'sender@yourdomain.com',
      condition: { field: 'operation', value: 'list_email_logs' },
      mode: 'advanced',
    },
    {
      id: 'logsSubject',
      title: 'Subject',
      type: 'short-input',
      placeholder: 'Order confirmation',
      condition: {
        field: 'operation',
        value: 'list_email_logs',
        and: { field: 'logsSubjectMatch', value: 'empty', not: true },
      },
      mode: 'advanced',
    },
    {
      id: 'logsSubjectMatch',
      title: 'Subject Match',
      type: 'dropdown',
      options: [
        { label: 'Contains', id: 'contain' },
        { label: 'Exact match', id: 'equal' },
        { label: 'Is empty', id: 'empty' },
      ],
      value: () => 'contain',
      condition: { field: 'operation', value: 'list_email_logs' },
      mode: 'advanced',
    },
    {
      id: 'logsStatus',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Delivered', id: 'delivered' },
        { label: 'Not delivered', id: 'not_delivered' },
        { label: 'Enqueued', id: 'enqueued' },
        { label: 'Opted out', id: 'opted_out' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_email_logs' },
    },
    {
      id: 'logsCategory',
      title: 'Category',
      type: 'short-input',
      placeholder: 'welcome',
      condition: { field: 'operation', value: 'list_email_logs' },
      mode: 'advanced',
    },
    {
      id: 'logsStream',
      title: 'Stream',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Transactional', id: 'transactional' },
        { label: 'Bulk', id: 'bulk' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'list_email_logs' },
      mode: 'advanced',
    },
    {
      id: 'searchAfter',
      title: 'Page Cursor',
      type: 'short-input',
      placeholder: 'nextPageCursor from a previous run',
      condition: { field: 'operation', value: 'list_email_logs' },
      mode: 'advanced',
    },
  ],

  tools: {
    access: [
      'mailtrap_send_email',
      'mailtrap_create_contact',
      'mailtrap_get_contact',
      'mailtrap_update_contact',
      'mailtrap_delete_contact',
      'mailtrap_list_contact_lists',
      'mailtrap_create_contact_list',
      'mailtrap_get_contact_list',
      'mailtrap_update_contact_list',
      'mailtrap_delete_contact_list',
      'mailtrap_list_email_logs',
      'mailtrap_get_email_log',
    ],
    config: {
      tool: (params) => `mailtrap_${params.operation}`,
      params: (params) => {
        const {
          operation,
          unsubscribed,
          logsTo,
          logsFrom,
          logsSubject,
          logsSubjectMatch,
          logsCategory,
          logsStatus,
          logsStream,
          ...rest
        } = params
        const blank = (value: unknown) => (value === '' || value === undefined ? undefined : value)

        if (operation === 'update_contact') {
          return {
            ...rest,
            unsubscribed: blank(unsubscribed) === undefined ? undefined : unsubscribed === 'true',
          }
        }

        if (operation === 'list_email_logs') {
          // Email-logs filter fields carry a `logs` prefix in the block to avoid
          // colliding with the send fields; map them onto the tool params.
          return {
            apiToken: rest.apiToken,
            sentAfter: blank(rest.sentAfter),
            sentBefore: blank(rest.sentBefore),
            searchAfter: blank(rest.searchAfter),
            to: blank(logsTo),
            fromAddress: blank(logsFrom),
            subject: blank(logsSubject),
            subjectMatch: blank(logsSubjectMatch),
            category: blank(logsCategory),
            status: blank(logsStatus),
            sendingStream: blank(logsStream),
          }
        }

        return rest
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiToken: { type: 'string', description: 'Mailtrap API token' },
    stream: { type: 'string', description: 'Sending stream (transactional, bulk, sandbox)' },
    sandboxId: { type: 'string', description: 'Sandbox id (sandbox stream only)' },
    from: { type: 'string', description: 'Sender address ("email" or "Name <email>")' },
    to: { type: 'string', description: 'Recipient address(es), comma-separated' },
    cc: { type: 'string', description: 'CC address(es), comma-separated' },
    bcc: { type: 'string', description: 'BCC address(es), comma-separated' },
    replyTo: { type: 'string', description: 'Reply-To address' },
    subject: { type: 'string', description: 'Email subject' },
    text: { type: 'string', description: 'Plain text body' },
    html: { type: 'string', description: 'HTML body' },
    category: { type: 'string', description: 'Category label for analytics' },
    customVariables: { type: 'string', description: 'Custom variables as a JSON object' },
    emailHeaders: { type: 'string', description: 'Additional SMTP headers as a JSON object' },
    templateUuid: { type: 'string', description: 'Mailtrap email template UUID' },
    templateVariables: { type: 'string', description: 'Template variables as a JSON object' },
    email: { type: 'string', description: 'Contact email address' },
    contactIdentifier: { type: 'string', description: 'Contact UUID or email address' },
    fields: { type: 'string', description: 'Contact field values as a JSON object' },
    listIds: { type: 'string', description: 'Contact list ids to add on create, comma-separated' },
    listIdsIncluded: { type: 'string', description: 'Contact list ids to add, comma-separated' },
    listIdsExcluded: { type: 'string', description: 'Contact list ids to remove, comma-separated' },
    unsubscribed: { type: 'string', description: 'Whether to unsubscribe the contact' },
    search: { type: 'string', description: 'Contact list name prefix filter' },
    name: { type: 'string', description: 'Contact list name' },
    listId: { type: 'string', description: 'Contact list id' },
    messageId: { type: 'string', description: 'Email log message UUID' },
    sentAfter: { type: 'string', description: 'Email logs: start of sent-at range (ISO 8601)' },
    sentBefore: { type: 'string', description: 'Email logs: end of sent-at range (ISO 8601)' },
    logsTo: {
      type: 'string',
      description: 'Email logs: recipient filter (case-insensitive exact match)',
    },
    logsFrom: {
      type: 'string',
      description: 'Email logs: sender filter (case-insensitive exact match)',
    },
    logsSubject: { type: 'string', description: 'Email logs: subject filter value' },
    logsSubjectMatch: {
      type: 'string',
      description: 'Email logs: subject match mode (contain, equal, empty)',
    },
    logsStatus: {
      type: 'string',
      description: 'Email logs: delivery status filter, exact match (comma-separated for any-of)',
    },
    logsCategory: {
      type: 'string',
      description: 'Email logs: category filter, exact match (comma-separated for any-of)',
    },
    logsStream: {
      type: 'string',
      description: 'Email logs: stream filter, transactional or bulk (comma-separated for any-of)',
    },
    searchAfter: { type: 'string', description: 'Email logs: pagination cursor' },
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
    messageIds: { type: 'json', description: 'Message ids returned by a send, one per recipient' },
    deleted: { type: 'boolean', description: 'Whether the resource was deleted' },
    action: { type: 'string', description: 'Whether an update created or updated the contact' },
    contact: { type: 'json', description: 'Contact record' },
    list: { type: 'json', description: 'Contact list record' },
    lists: { type: 'json', description: 'Array of contact lists' },
    message: { type: 'json', description: 'Email log message with its event timeline' },
    messages: { type: 'json', description: 'Array of email log messages' },
    totalCount: { type: 'number', description: 'Total email log messages matching the filters' },
    nextPageCursor: { type: 'string', description: 'Cursor for the next page of email logs' },
  },
}

export const MailtrapBlockMeta = {
  tags: ['email-marketing', 'messaging'],
  url: 'https://mailtrap.io',
  templates: [
    {
      icon: MailtrapIcon,
      title: 'Mailtrap sandbox QA gate',
      prompt:
        'Build a workflow that renders every outgoing notification email and sends it through the Mailtrap sandbox stream first, then checks the payload was accepted and only promotes the send to the transactional stream once the sandbox copy looks correct.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'testing', 'communication'],
    },
    {
      icon: MailtrapIcon,
      title: 'Mailtrap transactional sender',
      prompt:
        'Create a workflow that listens for order events, picks the right Mailtrap template, sends the confirmation through the transactional stream with the order number as a custom variable, and records the returned message id in a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'communication'],
    },
    {
      icon: MailtrapIcon,
      title: 'Mailtrap contact sync',
      prompt:
        'Build a scheduled workflow that reads my subscriber table, creates or updates each Mailtrap contact with its custom fields, adds it to the matching contact list, and unsubscribes contacts that opted out so Mailtrap stays in sync with the source of truth.',
      modules: ['tables', 'scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'sync', 'automation'],
    },
    {
      icon: MailtrapIcon,
      title: 'Mailtrap bulk campaign send',
      prompt:
        'Create a workflow that takes a campaign message and a Mailtrap contact list, splits the recipients into safe-volume batches, sends each batch through the Mailtrap bulk stream, and logs per-batch message ids and failures to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
    },
    {
      icon: MailtrapIcon,
      title: 'Mailtrap list housekeeping',
      prompt:
        'Build a scheduled workflow that lists every Mailtrap contact list, flags lists whose name is off our naming convention or looks stale (contains "old", "tmp", or a past year), posts the proposed renames and deletions to Slack for approval, then renames or deletes each list the team approves.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: MailtrapIcon,
      title: 'Mailtrap + Slack signup flow',
      prompt:
        'Create a workflow that fires on a new signup, creates the Mailtrap contact in the onboarding list, sends the welcome email through the transactional stream, and posts the new signup with the send status to a Slack channel.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['automation', 'communication', 'onboarding'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: MailtrapIcon,
      title: 'Mailtrap unsubscribe handler',
      prompt:
        'Build a workflow that listens for unsubscribe events, looks up the Mailtrap contact by email, sets it to unsubscribed, logs the opt-out reason to a table, and sends a short confirmation email through the transactional stream.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'communication', 'compliance'],
    },
  ],
  skills: [
    {
      name: 'send-email',
      description: 'Send an email through the right Mailtrap stream and confirm it was accepted.',
      content:
        '# Send Email\n\nSend a message through Mailtrap.\n\n## Steps\n1. Choose the stream: transactional for user-triggered mail, bulk for campaigns, sandbox for testing (needs a sandbox id).\n2. Set from, to, subject, and a text or HTML body, or a template uuid with template variables.\n3. Run the send operation.\n4. Read the returned message ids to confirm acceptance.\n\n## Output\nReturn the message ids. If the send fails, report the error reason.',
    },
    {
      name: 'sync-contact',
      description: 'Create or update a Mailtrap contact and place it in the right lists.',
      content:
        '# Sync Contact\n\nKeep a Mailtrap contact current.\n\n## Steps\n1. Run get contact by email to check whether it already exists.\n2. If new, run create contact with the email, fields, and list ids.\n3. If existing, run update contact to refresh fields, adjust list membership, or change the subscription state.\n\n## Output\nReturn the contact id and whether it was created or updated.',
    },
    {
      name: 'manage-contact-lists',
      description: 'Inspect and maintain Mailtrap contact lists.',
      content:
        '# Manage Contact Lists\n\nOrganize Mailtrap contact lists.\n\n## Steps\n1. Run list contact lists, optionally filtering by a name prefix.\n2. Create a list when a needed segment is missing.\n3. Rename a list to match the naming convention.\n4. Delete a list once the team has confirmed it is no longer needed (identify it by id or name — there is no member count available).\n\n## Output\nReturn the affected list ids and names.',
    },
  ],
} as const satisfies BlockMeta
