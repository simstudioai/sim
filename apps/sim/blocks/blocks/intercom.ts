import { IntercomIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { createVersionedToolSelector } from '@/blocks/utils'

export const IntercomBlock: BlockConfig = {
  type: 'intercom',
  name: 'Intercom (Legacy)',
  hideFromToolbar: true,
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
        { label: 'Update Ticket', id: 'update_ticket' },
        { label: 'Create Message', id: 'create_message' },
        { label: 'List Admins', id: 'list_admins' },
        { label: 'Close Conversation', id: 'close_conversation' },
        { label: 'Open Conversation', id: 'open_conversation' },
        { label: 'Snooze Conversation', id: 'snooze_conversation' },
        { label: 'Assign Conversation', id: 'assign_conversation' },
        { label: 'List Tags', id: 'list_tags' },
        { label: 'Create Tag', id: 'create_tag' },
        { label: 'Tag Contact', id: 'tag_contact' },
        { label: 'Untag Contact', id: 'untag_contact' },
        { label: 'Tag Conversation', id: 'tag_conversation' },
        { label: 'Create Note', id: 'create_note' },
        { label: 'Create Event', id: 'create_event' },
        { label: 'Attach Contact to Company', id: 'attach_contact_to_company' },
        { label: 'Detach Contact from Company', id: 'detach_contact_from_company' },
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
        value: [
          'get_conversation',
          'reply_conversation',
          'close_conversation',
          'open_conversation',
          'snooze_conversation',
          'assign_conversation',
          'tag_conversation',
        ],
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
      placeholder: 'ID of the admin performing the action',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'reply_conversation',
          'close_conversation',
          'open_conversation',
          'snooze_conversation',
          'assign_conversation',
          'tag_conversation',
          'create_note',
          'update_ticket',
        ],
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
        value: ['get_ticket', 'update_ticket'],
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
    // Close/Open conversation body
    {
      id: 'close_body',
      title: 'Closing Message',
      type: 'long-input',
      placeholder: 'Optional message to add when closing',
      condition: {
        field: 'operation',
        value: ['close_conversation'],
      },
    },
    // Snooze conversation
    {
      id: 'snoozed_until',
      title: 'Snooze Until',
      type: 'short-input',
      placeholder: 'Unix timestamp when conversation should reopen',
      required: true,
      condition: {
        field: 'operation',
        value: ['snooze_conversation'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Unix timestamp in seconds based on the user's description.
The timestamp should be a Unix epoch time in seconds (10 digits).
Examples:
- "tomorrow" -> Tomorrow at 09:00:00 as Unix timestamp
- "in 2 hours" -> Current time plus 7200 seconds
- "next Monday" -> Next Monday at 09:00:00 as Unix timestamp

Return ONLY the numeric timestamp - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe when to unsnooze (e.g., "tomorrow", "in 2 hours")...',
        generationType: 'timestamp',
      },
    },
    // Assign conversation
    {
      id: 'assignee_id',
      title: 'Assignee ID',
      type: 'short-input',
      placeholder: 'Admin or team ID to assign to (0 to unassign)',
      required: true,
      condition: {
        field: 'operation',
        value: ['assign_conversation'],
      },
    },
    {
      id: 'assign_body',
      title: 'Assignment Message',
      type: 'long-input',
      placeholder: 'Optional message when assigning',
      condition: {
        field: 'operation',
        value: ['assign_conversation'],
      },
    },
    // Update ticket fields
    {
      id: 'update_ticket_attributes',
      title: 'Ticket Attributes',
      type: 'long-input',
      placeholder: 'JSON object with ticket attributes to update',
      condition: {
        field: 'operation',
        value: ['update_ticket'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object for Intercom ticket attributes based on the user's description.
Example: {"_default_title_": "Updated title", "_default_description_": "Updated description"}

Return ONLY the JSON object - no explanations or markdown formatting.`,
        placeholder: 'Describe the ticket updates (e.g., "change title to Bug Fixed")...',
        generationType: 'json-object',
      },
    },
    {
      id: 'ticket_open',
      title: 'Ticket Open',
      type: 'dropdown',
      options: [
        { label: 'Keep Open', id: 'true' },
        { label: 'Close Ticket', id: 'false' },
      ],
      condition: {
        field: 'operation',
        value: ['update_ticket'],
      },
    },
    {
      id: 'ticket_is_shared',
      title: 'Ticket Visible to Users',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      condition: {
        field: 'operation',
        value: ['update_ticket'],
      },
    },
    {
      id: 'ticket_snoozed_until',
      title: 'Snooze Ticket Until',
      type: 'short-input',
      placeholder: 'Unix timestamp when ticket should reopen',
      condition: {
        field: 'operation',
        value: ['update_ticket'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Unix timestamp in seconds based on the user's description.
Examples:
- "tomorrow" -> Tomorrow at 09:00:00 as Unix timestamp
- "next week" -> 7 days from now

Return ONLY the numeric timestamp.`,
        placeholder: 'Describe when to unsnooze (e.g., "tomorrow")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'ticket_assignee_id',
      title: 'Ticket Assignee ID',
      type: 'short-input',
      placeholder: 'Admin or team ID to assign to (0 to unassign)',
      condition: {
        field: 'operation',
        value: ['update_ticket'],
      },
    },
    // Tag fields
    {
      id: 'tagId',
      title: 'Tag ID',
      type: 'short-input',
      placeholder: 'ID of the tag',
      required: true,
      condition: {
        field: 'operation',
        value: ['tag_contact', 'untag_contact', 'tag_conversation'],
      },
    },
    {
      id: 'tag_name',
      title: 'Tag Name',
      type: 'short-input',
      placeholder: 'Name of the tag to create',
      required: true,
      condition: {
        field: 'operation',
        value: ['create_tag'],
      },
    },
    {
      id: 'tag_id_update',
      title: 'Tag ID (for update)',
      type: 'short-input',
      placeholder: 'ID of existing tag to update (leave empty to create new)',
      condition: {
        field: 'operation',
        value: ['create_tag'],
      },
    },
    // Contact ID for tag/untag/note operations
    {
      id: 'tag_contact_id',
      title: 'Contact ID',
      type: 'short-input',
      placeholder: 'ID of the contact',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'tag_contact',
          'untag_contact',
          'create_note',
          'attach_contact_to_company',
          'detach_contact_from_company',
        ],
      },
    },
    // Note fields
    {
      id: 'note_body',
      title: 'Note Content',
      type: 'long-input',
      placeholder: 'Text content of the note',
      required: true,
      condition: {
        field: 'operation',
        value: ['create_note'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a note for Intercom based on the user's description.
The note should be clear, professional, and capture the key information.

Return ONLY the note text - no explanations.`,
        placeholder: 'Describe the note content (e.g., "customer requested callback")...',
      },
    },
    // Event fields
    {
      id: 'event_name',
      title: 'Event Name',
      type: 'short-input',
      placeholder: 'Event name (e.g., order-completed)',
      required: true,
      condition: {
        field: 'operation',
        value: ['create_event'],
      },
    },
    {
      id: 'event_user_id',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'Your identifier for the user',
      condition: {
        field: 'operation',
        value: ['create_event'],
      },
    },
    {
      id: 'event_email',
      title: 'User Email',
      type: 'short-input',
      placeholder: 'Email address of the user',
      condition: {
        field: 'operation',
        value: ['create_event'],
      },
    },
    {
      id: 'event_contact_id',
      title: 'Contact ID',
      type: 'short-input',
      placeholder: 'Intercom contact ID',
      condition: {
        field: 'operation',
        value: ['create_event'],
      },
    },
    {
      id: 'event_metadata',
      title: 'Event Metadata',
      type: 'long-input',
      placeholder: 'JSON object with event metadata (max 10 keys)',
      condition: {
        field: 'operation',
        value: ['create_event'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object for Intercom event metadata based on the user's description.
The object should contain key-value pairs (max 10 keys).
Example: {"order_value": 99.99, "items": 3, "coupon_used": true}

Return ONLY the JSON object - no explanations or markdown formatting.`,
        placeholder: 'Describe the event data (e.g., "order value $50, 2 items")...',
        generationType: 'json-object',
      },
    },
    {
      id: 'event_created_at',
      title: 'Event Time',
      type: 'short-input',
      placeholder: 'Unix timestamp when event occurred',
      condition: {
        field: 'operation',
        value: ['create_event'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Unix timestamp in seconds based on the user's description.
Examples:
- "now" -> Current Unix timestamp
- "5 minutes ago" -> Current time minus 300 seconds

Return ONLY the numeric timestamp.`,
        placeholder: 'Describe when the event occurred (e.g., "now")...',
        generationType: 'timestamp',
      },
    },
    // Company attachment fields
    {
      id: 'attach_company_id',
      title: 'Company ID',
      type: 'short-input',
      placeholder: 'ID of the company to attach/detach',
      required: true,
      condition: {
        field: 'operation',
        value: ['attach_contact_to_company', 'detach_contact_from_company'],
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
      'intercom_update_ticket_v2',
      'intercom_list_admins_v2',
      'intercom_close_conversation_v2',
      'intercom_open_conversation_v2',
      'intercom_snooze_conversation_v2',
      'intercom_assign_conversation_v2',
      'intercom_list_tags_v2',
      'intercom_create_tag_v2',
      'intercom_tag_contact_v2',
      'intercom_untag_contact_v2',
      'intercom_tag_conversation_v2',
      'intercom_create_note_v2',
      'intercom_create_event_v2',
      'intercom_attach_contact_to_company_v2',
      'intercom_detach_contact_from_company_v2',
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
          case 'update_ticket':
            return 'intercom_update_ticket_v2'
          case 'list_admins':
            return 'intercom_list_admins_v2'
          case 'close_conversation':
            return 'intercom_close_conversation_v2'
          case 'open_conversation':
            return 'intercom_open_conversation_v2'
          case 'snooze_conversation':
            return 'intercom_snooze_conversation_v2'
          case 'assign_conversation':
            return 'intercom_assign_conversation_v2'
          case 'list_tags':
            return 'intercom_list_tags_v2'
          case 'create_tag':
            return 'intercom_create_tag_v2'
          case 'tag_contact':
            return 'intercom_tag_contact_v2'
          case 'untag_contact':
            return 'intercom_untag_contact_v2'
          case 'tag_conversation':
            return 'intercom_tag_conversation_v2'
          case 'create_note':
            return 'intercom_create_note_v2'
          case 'create_event':
            return 'intercom_create_event_v2'
          case 'attach_contact_to_company':
            return 'intercom_attach_contact_to_company_v2'
          case 'detach_contact_from_company':
            return 'intercom_detach_contact_from_company_v2'
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
          close_body,
          assign_body,
          tag_contact_id,
          attach_company_id,
          update_ticket_attributes,
          ticket_open,
          ticket_is_shared,
          ticket_snoozed_until,
          ticket_assignee_id,
          tag_name,
          tag_id_update,
          note_body,
          event_user_id,
          event_email,
          event_contact_id,
          event_metadata,
          event_created_at,
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

        // Map ticket fields for create_ticket
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

        // Map close_body to body for close_conversation
        if (operation === 'close_conversation' && close_body) {
          cleanParams.body = close_body
        }

        // Map assign_body to body for assign_conversation
        if (operation === 'assign_conversation' && assign_body) {
          cleanParams.body = assign_body
        }

        // Map tag_contact_id to contactId for tag/note/company attachment operations
        if (
          [
            'tag_contact',
            'untag_contact',
            'create_note',
            'attach_contact_to_company',
            'detach_contact_from_company',
          ].includes(operation) &&
          tag_contact_id
        ) {
          cleanParams.contactId = tag_contact_id
        }

        // Map attach_company_id to companyId for company attachment operations
        if (
          ['attach_contact_to_company', 'detach_contact_from_company'].includes(operation) &&
          attach_company_id
        ) {
          cleanParams.companyId = attach_company_id
        }

        // Map update_ticket fields
        if (operation === 'update_ticket') {
          if (update_ticket_attributes) cleanParams.ticket_attributes = update_ticket_attributes
          if (ticket_open !== undefined && ticket_open !== '') {
            cleanParams.open = ticket_open === 'true'
          }
          if (ticket_is_shared !== undefined && ticket_is_shared !== '') {
            cleanParams.is_shared = ticket_is_shared === 'true'
          }
          if (ticket_snoozed_until) cleanParams.snoozed_until = Number(ticket_snoozed_until)
          if (ticket_assignee_id) cleanParams.assignee_id = ticket_assignee_id
        }

        // Map tag fields for create_tag
        if (operation === 'create_tag') {
          if (tag_name) cleanParams.name = tag_name
          if (tag_id_update) cleanParams.id = tag_id_update
        }

        // Map note_body to body for create_note
        if (operation === 'create_note' && note_body) {
          cleanParams.body = note_body
        }

        // Map event fields for create_event
        if (operation === 'create_event') {
          if (event_user_id) cleanParams.user_id = event_user_id
          if (event_email) cleanParams.email = event_email
          if (event_contact_id) cleanParams.id = event_contact_id
          if (event_metadata) cleanParams.metadata = event_metadata
          if (event_created_at) cleanParams.created_at = Number(event_created_at)
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

export const IntercomV2Block: BlockConfig = {
  ...IntercomBlock,
  type: 'intercom_v2',
  name: 'Intercom',
  hideFromToolbar: false,
  tools: {
    ...IntercomBlock.tools,
    access: [
      'intercom_create_contact_v2',
      'intercom_get_contact_v2',
      'intercom_update_contact_v2',
      'intercom_list_contacts_v2',
      'intercom_search_contacts_v2',
      'intercom_delete_contact_v2',
      'intercom_create_company_v2',
      'intercom_get_company_v2',
      'intercom_list_companies_v2',
      'intercom_get_conversation_v2',
      'intercom_list_conversations_v2',
      'intercom_reply_conversation_v2',
      'intercom_search_conversations_v2',
      'intercom_create_ticket_v2',
      'intercom_get_ticket_v2',
      'intercom_update_ticket_v2',
      'intercom_create_message_v2',
      'intercom_list_admins_v2',
      'intercom_close_conversation_v2',
      'intercom_open_conversation_v2',
      'intercom_snooze_conversation_v2',
      'intercom_assign_conversation_v2',
      'intercom_list_tags_v2',
      'intercom_create_tag_v2',
      'intercom_tag_contact_v2',
      'intercom_untag_contact_v2',
      'intercom_tag_conversation_v2',
      'intercom_create_note_v2',
      'intercom_create_event_v2',
      'intercom_attach_contact_to_company_v2',
      'intercom_detach_contact_from_company_v2',
    ],
    config: {
      tool: createVersionedToolSelector({
        baseToolSelector: (params) => {
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
            case 'update_ticket':
              return 'intercom_update_ticket'
            case 'create_message':
              return 'intercom_create_message'
            case 'list_admins':
              return 'intercom_list_admins'
            case 'close_conversation':
              return 'intercom_close_conversation'
            case 'open_conversation':
              return 'intercom_open_conversation'
            case 'snooze_conversation':
              return 'intercom_snooze_conversation'
            case 'assign_conversation':
              return 'intercom_assign_conversation'
            case 'list_tags':
              return 'intercom_list_tags'
            case 'create_tag':
              return 'intercom_create_tag'
            case 'tag_contact':
              return 'intercom_tag_contact'
            case 'untag_contact':
              return 'intercom_untag_contact'
            case 'tag_conversation':
              return 'intercom_tag_conversation'
            case 'create_note':
              return 'intercom_create_note'
            case 'create_event':
              return 'intercom_create_event'
            case 'attach_contact_to_company':
              return 'intercom_attach_contact_to_company'
            case 'detach_contact_from_company':
              return 'intercom_detach_contact_from_company'
            default:
              return 'intercom_create_contact'
          }
        },
        suffix: '_v2',
        fallbackToolId: 'intercom_create_contact_v2',
      }),
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
          close_body,
          assign_body,
          tag_contact_id,
          attach_company_id,
          update_ticket_attributes,
          ticket_open,
          ticket_is_shared,
          ticket_snoozed_until,
          ticket_assignee_id,
          tag_name,
          tag_id_update,
          note_body,
          event_user_id,
          event_email,
          event_contact_id,
          event_metadata,
          event_created_at,
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

        // Map ticket fields for create_ticket
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

        // Map close_body to body for close_conversation
        if (operation === 'close_conversation' && close_body) {
          cleanParams.body = close_body
        }

        // Map assign_body to body for assign_conversation
        if (operation === 'assign_conversation' && assign_body) {
          cleanParams.body = assign_body
        }

        // Map tag_contact_id to contactId for tag/note/company attachment operations
        if (
          [
            'tag_contact',
            'untag_contact',
            'create_note',
            'attach_contact_to_company',
            'detach_contact_from_company',
          ].includes(operation) &&
          tag_contact_id
        ) {
          cleanParams.contactId = tag_contact_id
        }

        // Map attach_company_id to companyId for company attachment operations
        if (
          ['attach_contact_to_company', 'detach_contact_from_company'].includes(operation) &&
          attach_company_id
        ) {
          cleanParams.companyId = attach_company_id
        }

        // Map update_ticket fields
        if (operation === 'update_ticket') {
          if (update_ticket_attributes) cleanParams.ticket_attributes = update_ticket_attributes
          if (ticket_open !== undefined && ticket_open !== '') {
            cleanParams.open = ticket_open === 'true'
          }
          if (ticket_is_shared !== undefined && ticket_is_shared !== '') {
            cleanParams.is_shared = ticket_is_shared === 'true'
          }
          if (ticket_snoozed_until) cleanParams.snoozed_until = Number(ticket_snoozed_until)
          if (ticket_assignee_id) cleanParams.assignee_id = ticket_assignee_id
        }

        // Map tag fields for create_tag
        if (operation === 'create_tag') {
          if (tag_name) cleanParams.name = tag_name
          if (tag_id_update) cleanParams.id = tag_id_update
        }

        // Map note_body to body for create_note
        if (operation === 'create_note' && note_body) {
          cleanParams.body = note_body
        }

        // Map event fields for create_event
        if (operation === 'create_event') {
          if (event_user_id) cleanParams.user_id = event_user_id
          if (event_email) cleanParams.email = event_email
          if (event_contact_id) cleanParams.id = event_contact_id
          if (event_metadata) cleanParams.metadata = event_metadata
          if (event_created_at) cleanParams.created_at = Number(event_created_at)
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
  outputs: {
    contact: {
      type: 'json',
      description:
        'Contact object with id, type, role, email, phone, name, external_id, created_at, updated_at',
    },
    contactId: { type: 'string', description: 'ID of the contact (for create/update operations)' },
    contacts: { type: 'array', description: 'Array of contacts (for list/search operations)' },
    company: { type: 'json', description: 'Company object with id, company_id, name, website' },
    companyId: { type: 'string', description: 'ID of the company (for create operations)' },
    companies: { type: 'array', description: 'Array of companies (for list operations)' },
    conversation: { type: 'json', description: 'Conversation object with id, title, state, open' },
    conversationId: {
      type: 'string',
      description: 'ID of the conversation (for reply operations)',
    },
    conversations: {
      type: 'array',
      description: 'Array of conversations (for list/search operations)',
    },
    state: { type: 'string', description: 'Conversation state (for close/open/snooze operations)' },
    ticket: { type: 'json', description: 'Ticket object with id, ticket_id, ticket_state' },
    ticketId: { type: 'string', description: 'ID of the ticket (for create/update operations)' },
    ticket_state: { type: 'string', description: 'Ticket state (for update_ticket operation)' },
    message: { type: 'json', description: 'Message object with id, type' },
    messageId: { type: 'string', description: 'ID of the message (for create operations)' },
    admins: { type: 'array', description: 'Array of admin objects (for list_admins operation)' },
    tags: { type: 'array', description: 'Array of tag objects (for list_tags operation)' },
    tag: { type: 'json', description: 'Tag object with id and name (for tag operations)' },
    tagId: { type: 'string', description: 'ID of the tag (for create_tag operation)' },
    note: { type: 'json', description: 'Note object with id and body (for create_note operation)' },
    noteId: { type: 'string', description: 'ID of the note (for create_note operation)' },
    event_name: {
      type: 'string',
      description: 'Name of the tracked event (for create_event operation)',
    },
    name: { type: 'string', description: 'Name of the resource (for various operations)' },
    total_count: { type: 'number', description: 'Total count (for list/search operations)' },
    pages: { type: 'json', description: 'Pagination info with page, per_page, total_pages' },
    id: { type: 'string', description: 'ID of the deleted item (for delete operations)' },
    deleted: {
      type: 'boolean',
      description: 'Whether the item was deleted (for delete operations)',
    },
  },
}
