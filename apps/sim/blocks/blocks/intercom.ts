import { IntercomIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'

export const IntercomBlock: BlockConfig = {
  type: 'intercom',
  name: 'Intercom',
  description: 'Manage contacts, companies, conversations, tickets, and messages in Intercom',
  longDescription:
    'Integrate Intercom into the workflow. Can create, get, update, list, search, and delete contacts; create, get, and list companies; get, list, reply, and search conversations; create and get tickets; and create messages.',
  docsLink: 'https://docs.sim.ai/tools/intercom',
  authMode: AuthMode.ApiKey,
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: IntercomIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Contact', id: 'create_contact' },
        { label: 'Get Contact', id: 'get_contact' },
        { label: 'Update Contact', id: 'update_contact' },
        { label: 'List Contacts', id: 'list_contacts' },
        { label: 'Search Contacts', id: 'search_contacts' },
        { label: 'Delete Contact', id: 'delete_contact' },
        { label: 'Create Company', id: 'create_company' },
        { label: 'Get Company', id: 'get_company' },
        { label: 'List Companies', id: 'list_companies' },
        { label: 'Get Conversation', id: 'get_conversation' },
        { label: 'List Conversations', id: 'list_conversations' },
        { label: 'Reply to Conversation', id: 'reply_conversation' },
        { label: 'Search Conversations', id: 'search_conversations' },
        { label: 'Create Ticket', id: 'create_ticket' },
        { label: 'Get Ticket', id: 'get_ticket' },
        { label: 'Create Message', id: 'create_message' },
      ],
      value: () => 'create_contact',
    },
    {
      id: 'accessToken',
      title: 'Access Token',
      type: 'short-input',
      password: true,
      placeholder: 'Enter your Intercom access token',
      required: true,
    },
    // Contact fields
    {
      id: 'role',
      title: 'Role',
      type: 'dropdown',
      options: [
        { label: 'Lead', id: 'lead' },
        { label: 'User', id: 'user' },
      ],
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact'],
      },
    },
    {
      id: 'contactId',
      title: 'Contact ID',
      type: 'short-input',
      placeholder: 'Contact ID',
      required: true,
      condition: {
        field: 'operation',
        value: ['get_contact', 'update_contact', 'delete_contact'],
      },
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'Contact email',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact'],
      },
    },
    {
      id: 'external_id',
      title: 'External ID',
      type: 'short-input',
      placeholder: 'External identifier for the contact',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact'],
      },
    },
    {
      id: 'phone',
      title: 'Phone',
      type: 'short-input',
      placeholder: 'Contact phone number',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact'],
      },
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Contact name',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact'],
      },
    },
    {
      id: 'avatar',
      title: 'Avatar URL',
      type: 'short-input',
      placeholder: 'Avatar image URL',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact'],
      },
    },
    {
      id: 'signed_up_at',
      title: 'Signed Up At',
      type: 'short-input',
      placeholder: 'Unix timestamp',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Unix timestamp in seconds based on the user's description.
The timestamp should be a Unix epoch time in seconds (10 digits).
Examples:
- "yesterday" -> Yesterday at 00:00:00 as Unix timestamp
- "last week" -> 7 days ago at 00:00:00 as Unix timestamp
- "January 1, 2024" -> 1704067200

Return ONLY the numeric timestamp - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the signup date (e.g., "yesterday", "January 1, 2024")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'last_seen_at',
      title: 'Last Seen At',
      type: 'short-input',
      placeholder: 'Unix timestamp',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Unix timestamp in seconds based on the user's description.
The timestamp should be a Unix epoch time in seconds (10 digits).
Examples:
- "now" -> Current Unix timestamp
- "1 hour ago" -> Current time minus 3600 seconds
- "today at noon" -> Today at 12:00:00 as Unix timestamp

Return ONLY the numeric timestamp - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the last seen time (e.g., "now", "1 hour ago")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'owner_id',
      title: 'Owner ID',
      type: 'short-input',
      placeholder: 'Admin ID',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact'],
      },
    },
    {
      id: 'unsubscribed_from_emails',
      title: 'Unsubscribed from Emails',
      type: 'dropdown',
      options: [
        { label: 'True', id: 'true' },
        { label: 'False', id: 'false' },
      ],
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact'],
      },
    },
    {
      id: 'custom_attributes',
      title: 'Custom Attributes',
      type: 'long-input',
      placeholder: 'JSON object with custom attributes',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object for Intercom custom attributes based on the user's description.
The object should contain key-value pairs for custom contact attributes.
Example: {"plan_type": "enterprise", "signup_source": "website", "industry": "technology"}

Return ONLY the JSON object - no explanations or markdown formatting.`,
        placeholder:
          'Describe the custom attributes (e.g., "enterprise customer, signed up from marketing campaign")...',
        generationType: 'json-object',
      },
    },
    {
      id: 'contact_company_id',
      title: 'Company ID',
      type: 'short-input',
      placeholder: 'Company ID to associate with contact',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact'],
      },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      placeholder: 'JSON search query or text',
      required: true,
      condition: {
        field: 'operation',
        value: ['search_contacts', 'search_conversations'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a search query for Intercom based on the user's description.
This can be either:
1. A simple text search query
2. A JSON query object for advanced filtering

Return ONLY the query - no explanations.`,
        placeholder:
          'Describe what you want to search for (e.g., "active users from last week", "open conversations about billing")...',
      },
    },
    {
      id: 'sort_field',
      title: 'Sort Field',
      type: 'short-input',
      placeholder: 'Field to sort by (e.g., name, created_at)',
      condition: {
        field: 'operation',
        value: ['search_contacts', 'search_conversations'],
      },
    },
    {
      id: 'sort_order',
      title: 'Sort Order',
      type: 'dropdown',
      options: [
        { label: 'Descending', id: 'descending' },
        { label: 'Ascending', id: 'ascending' },
      ],
      condition: {
        field: 'operation',
        value: ['search_contacts', 'search_conversations'],
      },
    },
    // Company fields
    {
      id: 'companyId',
      title: 'Company ID',
      type: 'short-input',
      placeholder: 'Intercom company ID',
      required: true,
      condition: {
        field: 'operation',
        value: ['get_company'],
      },
    },
    {
      id: 'company_id',
      title: 'Company ID (External)',
      type: 'short-input',
      placeholder: 'Your unique identifier for the company',
      required: true,
      condition: {
        field: 'operation',
        value: ['create_company'],
      },
    },
    {
      id: 'company_name',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Company name',
      condition: {
        field: 'operation',
        value: ['create_company'],
      },
    },
    {
      id: 'website',
      title: 'Website',
      type: 'short-input',
      placeholder: 'Company website',
      condition: {
        field: 'operation',
        value: ['create_company'],
      },
    },
    {
      id: 'plan',
      title: 'Plan',
      type: 'short-input',
      placeholder: 'Subscription plan',
      condition: {
        field: 'operation',
        value: ['create_company'],
      },
    },
    {
      id: 'size',
      title: 'Size',
      type: 'short-input',
      placeholder: 'Number of employees',
      condition: {
        field: 'operation',
        value: ['create_company'],
      },
    },
    {
      id: 'industry',
      title: 'Industry',
      type: 'short-input',
      placeholder: 'Company industry',
      condition: {
        field: 'operation',
        value: ['create_company'],
      },
    },
    {
      id: 'monthly_spend',
      title: 'Monthly Spend',
      type: 'short-input',
      placeholder: 'Revenue amount',
      condition: {
        field: 'operation',
        value: ['create_company'],
      },
    },
    {
      id: 'remote_created_at',
      title: 'Remote Created At',
      type: 'short-input',
      placeholder: 'Unix timestamp when company was created',
      condition: {
        field: 'operation',
        value: ['create_company'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Unix timestamp in seconds based on the user's description.
The timestamp should be a Unix epoch time in seconds (10 digits).
Examples:
- "2 years ago" -> Calculate 2 years ago as Unix timestamp
- "January 2022" -> January 1, 2022 at 00:00:00 as Unix timestamp
- "last year" -> 1 year ago at 00:00:00 as Unix timestamp

Return ONLY the numeric timestamp - no explanations, no quotes, no extra text.`,
        placeholder:
          'Describe when the company was created (e.g., "2 years ago", "January 2022")...',
        generationType: 'timestamp',
      },
    },
    // Conversation fields
    {
      id: 'conversationId',
      title: 'Conversation ID',
      type: 'short-input',
      placeholder: 'Conversation ID',
      required: true,
      condition: {
        field: 'operation',
        value: ['get_conversation', 'reply_conversation'],
      },
    },
    {
      id: 'display_as',
      title: 'Display As',
      type: 'dropdown',
      options: [
        { label: 'HTML', id: 'html' },
        { label: 'Plain Text', id: 'plaintext' },
      ],
      condition: {
        field: 'operation',
        value: ['get_conversation'],
      },
    },
    {
      id: 'include_translations',
      title: 'Include Translations',
      type: 'dropdown',
      options: [
        { label: 'False', id: 'false' },
        { label: 'True', id: 'true' },
      ],
      condition: {
        field: 'operation',
        value: ['get_conversation'],
      },
    },
    {
      id: 'sort',
      title: 'Sort By',
      type: 'short-input',
      placeholder: 'Field to sort by (e.g., waiting_since, updated_at)',
      condition: {
        field: 'operation',
        value: ['list_conversations'],
      },
    },
    {
      id: 'order',
      title: 'Order',
      type: 'dropdown',
      options: [
        { label: 'Descending', id: 'desc' },
        { label: 'Ascending', id: 'asc' },
      ],
      condition: {
        field: 'operation',
        value: ['list_conversations'],
      },
    },
    {
      id: 'message_type',
      title: 'Message Type',
      type: 'dropdown',
      options: [
        { label: 'Comment', id: 'comment' },
        { label: 'Note', id: 'note' },
      ],
      required: true,
      condition: {
        field: 'operation',
        value: ['reply_conversation'],
      },
    },
    {
      id: 'body',
      title: 'Message Body',
      type: 'long-input',
      placeholder: 'Message text',
      required: true,
      condition: {
        field: 'operation',
        value: ['reply_conversation', 'create_message'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a message body for Intercom based on the user's description.
The message should:
- Be professional and friendly
- Be clear and concise
- Match the context (support reply, outreach, etc.)

Return ONLY the message text - no explanations.`,
        placeholder:
          'Describe the message you want to send (e.g., "thank customer for feedback", "follow up on support ticket")...',
      },
    },
    {
      id: 'admin_id',
      title: 'Admin ID',
      type: 'short-input',
      placeholder: 'ID of the admin sending the message',
      required: true,
      condition: {
        field: 'operation',
        value: ['reply_conversation'],
      },
    },
    {
      id: 'attachment_urls',
      title: 'Attachment URLs',
      type: 'short-input',
      placeholder: 'Comma-separated image URLs (max 10)',
      condition: {
        field: 'operation',
        value: ['reply_conversation'],
      },
    },
    {
      id: 'reply_created_at',
      title: 'Created At',
      type: 'short-input',
      placeholder: 'Unix timestamp for reply creation time',
      condition: {
        field: 'operation',
        value: ['reply_conversation'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Unix timestamp in seconds based on the user's description.
The timestamp should be a Unix epoch time in seconds (10 digits).
Examples:
- "now" -> Current Unix timestamp
- "5 minutes ago" -> Current time minus 300 seconds
- "earlier today" -> Today at 09:00:00 as Unix timestamp

Return ONLY the numeric timestamp - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the reply time (e.g., "now", "5 minutes ago")...',
        generationType: 'timestamp',
      },
    },
    // Ticket fields
    {
      id: 'ticketId',
      title: 'Ticket ID',
      type: 'short-input',
      placeholder: 'Ticket ID',
      required: true,
      condition: {
        field: 'operation',
        value: ['get_ticket'],
      },
    },
    {
      id: 'ticket_type_id',
      title: 'Ticket Type ID',
      type: 'short-input',
      placeholder: 'ID of the ticket type',
      required: true,
      condition: {
        field: 'operation',
        value: ['create_ticket'],
      },
    },
    {
      id: 'contacts',
      title: 'Contacts',
      type: 'long-input',
      placeholder: 'JSON array of contact identifiers',
      required: true,
      condition: {
        field: 'operation',
        value: ['create_ticket'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of contact identifiers for Intercom based on the user's description.
The array should contain contact identifier objects.
Example: [{"id": "contact_id_1"}, {"id": "contact_id_2"}] or [{"email": "user@example.com"}]

Return ONLY the JSON array - no explanations or markdown formatting.`,
        placeholder: 'Describe the contacts (e.g., "user with email john@example.com")...',
        generationType: 'json-object',
      },
    },
    {
      id: 'ticket_attributes',
      title: 'Ticket Attributes',
      type: 'long-input',
      placeholder: 'JSON object with ticket attributes',
      required: true,
      condition: {
        field: 'operation',
        value: ['create_ticket'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object for Intercom ticket attributes based on the user's description.
The object should contain the ticket's custom attributes based on your ticket type schema.
Example: {"_default_title_": "Issue title", "_default_description_": "Issue description", "priority": "high"}

Return ONLY the JSON object - no explanations or markdown formatting.`,
        placeholder: 'Describe the ticket (e.g., "high priority bug report about login issues")...',
        generationType: 'json-object',
      },
    },
    {
      id: 'ticket_company_id',
      title: 'Company ID',
      type: 'short-input',
      placeholder: 'Company ID to associate with ticket',
      condition: {
        field: 'operation',
        value: ['create_ticket'],
      },
    },
    {
      id: 'ticket_created_at',
      title: 'Created At',
      type: 'short-input',
      placeholder: 'Unix timestamp for ticket creation time',
      condition: {
        field: 'operation',
        value: ['create_ticket'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Unix timestamp in seconds based on the user's description.
The timestamp should be a Unix epoch time in seconds (10 digits).
Examples:
- "now" -> Current Unix timestamp
- "when the issue was reported" -> Use current time
- "yesterday" -> Yesterday at 00:00:00 as Unix timestamp

Return ONLY the numeric timestamp - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the ticket creation time (e.g., "now", "yesterday")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'conversation_to_link_id',
      title: 'Conversation to Link',
      type: 'short-input',
      placeholder: 'ID of conversation to link to ticket',
      condition: {
        field: 'operation',
        value: ['create_ticket'],
      },
    },
    {
      id: 'disable_notifications',
      title: 'Disable Notifications',
      type: 'dropdown',
      options: [
        { label: 'False', id: 'false' },
        { label: 'True', id: 'true' },
      ],
      condition: {
        field: 'operation',
        value: ['create_ticket'],
      },
    },
    // Message fields
    {
      id: 'message_type_msg',
      title: 'Message Type',
      type: 'dropdown',
      options: [
        { label: 'In-App', id: 'inapp' },
        { label: 'Email', id: 'email' },
      ],
      required: true,
      condition: {
        field: 'operation',
        value: ['create_message'],
      },
    },
    {
      id: 'template',
      title: 'Template',
      type: 'dropdown',
      options: [
        { label: 'Plain', id: 'plain' },
        { label: 'Personal', id: 'personal' },
      ],
      required: true,
      condition: {
        field: 'operation',
        value: ['create_message'],
      },
    },
    {
      id: 'subject',
      title: 'Subject',
      type: 'short-input',
      placeholder: 'Email subject (for email type)',
      condition: {
        field: 'operation',
        value: ['create_message'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate an email subject line for Intercom based on the user's description.
The subject should:
- Be concise and attention-grabbing
- Clearly indicate the email purpose
- Be professional

Return ONLY the subject line - no explanations.`,
        placeholder:
          'Describe the email purpose (e.g., "welcome new customer", "feature announcement")...',
      },
    },
    {
      id: 'from_type',
      title: 'From Type',
      type: 'dropdown',
      options: [{ label: 'Admin', id: 'admin' }],
      required: true,
      condition: {
        field: 'operation',
        value: ['create_message'],
      },
    },
    {
      id: 'from_id',
      title: 'From ID',
      type: 'short-input',
      placeholder: 'Admin ID',
      required: true,
      condition: {
        field: 'operation',
        value: ['create_message'],
      },
    },
    {
      id: 'to_type',
      title: 'To Type',
      type: 'dropdown',
      options: [{ label: 'Contact', id: 'contact' }],
      required: true,
      condition: {
        field: 'operation',
        value: ['create_message'],
      },
    },
    {
      id: 'to_id',
      title: 'To ID',
      type: 'short-input',
      placeholder: 'Contact ID',
      required: true,
      condition: {
        field: 'operation',
        value: ['create_message'],
      },
    },
    {
      id: 'message_created_at',
      title: 'Created At',
      type: 'short-input',
      placeholder: 'Unix timestamp for message creation time',
      condition: {
        field: 'operation',
        value: ['create_message'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Unix timestamp in seconds based on the user's description.
The timestamp should be a Unix epoch time in seconds (10 digits).
Examples:
- "now" -> Current Unix timestamp
- "just now" -> Current Unix timestamp
- "a few minutes ago" -> Current time minus 300 seconds

Return ONLY the numeric timestamp - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the message time (e.g., "now", "just now")...',
        generationType: 'timestamp',
      },
    },
    // Pagination fields
    {
      id: 'per_page',
      title: 'Per Page',
      type: 'short-input',
      placeholder: 'Results per page (max: 150)',
      condition: {
        field: 'operation',
        value: [
          'list_contacts',
          'search_contacts',
          'list_companies',
          'list_conversations',
          'search_conversations',
        ],
      },
    },
    {
      id: 'starting_after',
      title: 'Starting After',
      type: 'short-input',
      placeholder: 'Cursor for pagination',
      condition: {
        field: 'operation',
        value: [
          'list_contacts',
          'search_contacts',
          'list_companies',
          'list_conversations',
          'search_conversations',
        ],
      },
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: 'Page number',
      condition: {
        field: 'operation',
        value: ['list_companies'],
      },
    },
  ],
  tools: {
    access: [
      'intercom_create_contact',
      'intercom_get_contact',
      'intercom_update_contact',
      'intercom_list_contacts',
      'intercom_search_contacts',
      'intercom_delete_contact',
      'intercom_create_company',
      'intercom_get_company',
      'intercom_list_companies',
      'intercom_get_conversation',
      'intercom_list_conversations',
      'intercom_reply_conversation',
      'intercom_search_conversations',
      'intercom_create_ticket',
      'intercom_get_ticket',
      'intercom_create_message',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'create_contact':
            return 'intercom_create_contact'
          case 'get_contact':
            return 'intercom_get_contact'
          case 'update_contact':
            return 'intercom_update_contact'
          case 'list_contacts':
            return 'intercom_list_contacts'
          case 'search_contacts':
            return 'intercom_search_contacts'
          case 'delete_contact':
            return 'intercom_delete_contact'
          case 'create_company':
            return 'intercom_create_company'
          case 'get_company':
            return 'intercom_get_company'
          case 'list_companies':
            return 'intercom_list_companies'
          case 'get_conversation':
            return 'intercom_get_conversation'
          case 'list_conversations':
            return 'intercom_list_conversations'
          case 'reply_conversation':
            return 'intercom_reply_conversation'
          case 'search_conversations':
            return 'intercom_search_conversations'
          case 'create_ticket':
            return 'intercom_create_ticket'
          case 'get_ticket':
            return 'intercom_get_ticket'
          case 'create_message':
            return 'intercom_create_message'
          default:
            throw new Error(`Unknown operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          operation,
          message_type_msg,
          company_name,
          contact_company_id,
          reply_created_at,
          ticket_company_id,
          ticket_created_at,
          message_created_at,
          include_translations,
          disable_notifications,
          ...rest
        } = params
        const cleanParams: Record<string, any> = {}

        // Special mapping for message_type in create_message
        if (operation === 'create_message' && message_type_msg) {
          cleanParams.message_type = message_type_msg
        }

        // Special mapping for company name
        if (operation === 'create_company' && company_name) {
          cleanParams.name = company_name
        }

        // Map contact_company_id to company_id for contact operations
        if (
          (operation === 'create_contact' || operation === 'update_contact') &&
          contact_company_id
        ) {
          cleanParams.company_id = contact_company_id
        }

        // Map reply_created_at to created_at for reply_conversation
        if (operation === 'reply_conversation' && reply_created_at) {
          cleanParams.created_at = Number(reply_created_at)
        }

        // Map ticket fields
        if (operation === 'create_ticket') {
          if (ticket_company_id) cleanParams.company_id = ticket_company_id
          if (ticket_created_at) cleanParams.created_at = Number(ticket_created_at)
          if (disable_notifications !== undefined && disable_notifications !== '') {
            cleanParams.disable_notifications = disable_notifications === 'true'
          }
        }

        // Map message_created_at to created_at for create_message
        if (operation === 'create_message' && message_created_at) {
          cleanParams.created_at = Number(message_created_at)
        }

        // Convert include_translations string to boolean for get_conversation
        if (
          operation === 'get_conversation' &&
          include_translations !== undefined &&
          include_translations !== ''
        ) {
          cleanParams.include_translations = include_translations === 'true'
        }

        Object.entries(rest).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== '') {
            cleanParams[key] = value
          }
        })

        return cleanParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    accessToken: { type: 'string', description: 'Intercom API access token' },
  },
  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: { type: 'json', description: 'Operation result data' },
  },
}
