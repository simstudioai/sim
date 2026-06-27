import { ResendIcon } from '@/components/icons'
import { ResendBlockDisplay } from '@/blocks/blocks/resend.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { getTrigger } from '@/triggers'

export const ResendBlock: BlockConfig = {
  ...ResendBlockDisplay,
  authMode: AuthMode.ApiKey,

  triggers: {
    enabled: true,
    available: [
      'resend_email_sent',
      'resend_email_delivered',
      'resend_email_bounced',
      'resend_email_complained',
      'resend_email_opened',
      'resend_email_clicked',
      'resend_email_failed',
      'resend_webhook',
    ],
  },

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Send Email', id: 'send_email' },
        { label: 'Get Email', id: 'get_email' },
        { label: 'Create Contact', id: 'create_contact' },
        { label: 'List Contacts', id: 'list_contacts' },
        { label: 'Get Contact', id: 'get_contact' },
        { label: 'Update Contact', id: 'update_contact' },
        { label: 'Delete Contact', id: 'delete_contact' },
        { label: 'List Domains', id: 'list_domains' },
      ],
      value: () => 'send_email',
    },
    {
      id: 'resendApiKey',
      title: 'Resend API Key',
      type: 'short-input',
      placeholder: 'Your Resend API key',
      required: true,
      password: true,
    },

    {
      id: 'fromAddress',
      title: 'From Address',
      type: 'short-input',
      placeholder: 'sender@yourdomain.com',
      condition: { field: 'operation', value: 'send_email' },
      required: true,
    },
    {
      id: 'to',
      title: 'To',
      type: 'short-input',
      placeholder: 'recipient@example.com',
      condition: { field: 'operation', value: 'send_email' },
      required: true,
    },
    {
      id: 'subject',
      title: 'Subject',
      type: 'short-input',
      placeholder: 'Email subject',
      condition: { field: 'operation', value: 'send_email' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a compelling email subject line based on the user's description.

### GUIDELINES
- Keep it concise (50 characters or less is ideal)
- Make it attention-grabbing
- Avoid spam trigger words
- Be clear about the email content

### EXAMPLES
"Welcome email for new users" -> "Welcome to Our Platform!"
"Order confirmation" -> "Your Order #12345 is Confirmed"
"Newsletter about new features" -> "New Features You'll Love"

Return ONLY the subject line - no explanations, no extra text.`,
        placeholder: 'Describe the email topic...',
      },
    },
    {
      id: 'body',
      title: 'Body',
      type: 'long-input',
      placeholder: 'Email body content',
      condition: { field: 'operation', value: 'send_email' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate email content based on the user's description.

### GUIDELINES
- Use clear, readable formatting
- Keep paragraphs short
- Include appropriate greeting and sign-off

Return ONLY the email body - no explanations, no extra text.`,
        placeholder: 'Describe the email content...',
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
      value: () => 'text',
      condition: { field: 'operation', value: 'send_email' },
      mode: 'advanced',
    },
    {
      id: 'cc',
      title: 'CC',
      type: 'short-input',
      placeholder: 'cc@example.com',
      condition: { field: 'operation', value: 'send_email' },
      mode: 'advanced',
    },
    {
      id: 'bcc',
      title: 'BCC',
      type: 'short-input',
      placeholder: 'bcc@example.com',
      condition: { field: 'operation', value: 'send_email' },
      mode: 'advanced',
    },
    {
      id: 'replyTo',
      title: 'Reply To',
      type: 'short-input',
      placeholder: 'reply@example.com',
      condition: { field: 'operation', value: 'send_email' },
      mode: 'advanced',
    },
    {
      id: 'scheduledAt',
      title: 'Schedule At',
      type: 'short-input',
      placeholder: '2024-08-05T11:52:01.858Z',
      condition: { field: 'operation', value: 'send_email' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        prompt:
          'Generate an ISO 8601 timestamp for scheduling email delivery. Return ONLY the timestamp - no explanations, no extra text.',
        placeholder: 'Describe when to send (e.g., "tomorrow at 9am")...',
      },
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'category:welcome,type:onboarding',
      condition: { field: 'operation', value: 'send_email' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate comma-separated key:value pairs for email tags based on the description. Example format: "category:welcome,type:onboarding". Return ONLY the tag pairs - no explanations, no extra text.',
        placeholder: 'Describe the email tags...',
      },
    },

    {
      id: 'emailId',
      title: 'Email ID',
      type: 'short-input',
      placeholder: 'Email ID to retrieve',
      condition: { field: 'operation', value: 'get_email' },
      required: true,
    },

    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'contact@example.com',
      condition: { field: 'operation', value: 'create_contact' },
      required: true,
    },
    {
      id: 'firstName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'John',
      condition: { field: 'operation', value: ['create_contact', 'update_contact'] },
    },
    {
      id: 'lastName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Doe',
      condition: { field: 'operation', value: ['create_contact', 'update_contact'] },
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
      condition: { field: 'operation', value: ['create_contact', 'update_contact'] },
    },

    {
      id: 'contactId',
      title: 'Contact ID or Email',
      type: 'short-input',
      placeholder: 'Contact ID or email address',
      condition: { field: 'operation', value: ['get_contact', 'update_contact', 'delete_contact'] },
      required: true,
    },

    ...getTrigger('resend_email_sent').subBlocks,
    ...getTrigger('resend_email_delivered').subBlocks,
    ...getTrigger('resend_email_bounced').subBlocks,
    ...getTrigger('resend_email_complained').subBlocks,
    ...getTrigger('resend_email_opened').subBlocks,
    ...getTrigger('resend_email_clicked').subBlocks,
    ...getTrigger('resend_email_failed').subBlocks,
    ...getTrigger('resend_webhook').subBlocks,
  ],

  tools: {
    access: [
      'resend_send',
      'resend_get_email',
      'resend_create_contact',
      'resend_list_contacts',
      'resend_get_contact',
      'resend_update_contact',
      'resend_delete_contact',
      'resend_list_domains',
    ],
    config: {
      tool: (params) => {
        const operation = params.operation || 'send_email'
        if (operation === 'send_email') return 'resend_send'
        return `resend_${operation}`
      },
      params: (params) => {
        const { operation, ...rest } = params

        if (rest.unsubscribed === undefined || rest.unsubscribed === '') {
          rest.unsubscribed = undefined
        } else {
          rest.unsubscribed = rest.unsubscribed === 'true'
        }

        return rest
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    resendApiKey: { type: 'string', description: 'Resend API key' },
    fromAddress: { type: 'string', description: 'Email address to send from' },
    to: { type: 'string', description: 'Recipient email address' },
    subject: { type: 'string', description: 'Email subject' },
    body: { type: 'string', description: 'Email body content' },
    contentType: { type: 'string', description: 'Content type (text or html)' },
    cc: { type: 'string', description: 'CC email address' },
    bcc: { type: 'string', description: 'BCC email address' },
    replyTo: { type: 'string', description: 'Reply-to email address' },
    scheduledAt: { type: 'string', description: 'Scheduled send time in ISO 8601 format' },
    tags: { type: 'string', description: 'Email tags as key:value pairs' },
    emailId: { type: 'string', description: 'Email ID to retrieve' },
    email: { type: 'string', description: 'Contact email address' },
    firstName: { type: 'string', description: 'Contact first name' },
    lastName: { type: 'string', description: 'Contact last name' },
    unsubscribed: { type: 'string', description: 'Contact subscription status' },
    contactId: { type: 'string', description: 'Contact ID or email address' },
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    id: { type: 'string', description: 'Email or contact ID' },
    to: { type: 'string', description: 'Recipient email address' },
    subject: { type: 'string', description: 'Email subject' },
    body: { type: 'string', description: 'Email body content' },
    from: { type: 'string', description: 'Sender email address' },
    html: { type: 'string', description: 'HTML email content' },
    text: { type: 'string', description: 'Plain text email content' },
    lastEvent: { type: 'string', description: 'Last event status' },
    createdAt: { type: 'string', description: 'Creation timestamp' },
    scheduledAt: { type: 'string', description: 'Scheduled send timestamp' },
    tags: { type: 'json', description: 'Email tags as name-value pairs' },
    email: { type: 'string', description: 'Contact email address' },
    firstName: { type: 'string', description: 'Contact first name' },
    lastName: { type: 'string', description: 'Contact last name' },
    unsubscribed: { type: 'boolean', description: 'Whether the contact is unsubscribed' },
    contacts: { type: 'json', description: 'Array of contacts' },
    domains: { type: 'json', description: 'Array of domains' },
    hasMore: { type: 'boolean', description: 'Whether more results are available' },
    deleted: { type: 'boolean', description: 'Whether the resource was deleted' },
  },
}

export const ResendBlockMeta = {
  tags: ['email-marketing', 'messaging'],
  url: 'https://resend.com',
  templates: [
    {
      icon: ResendIcon,
      title: 'Resend + Loops onboarding emails',
      prompt:
        'Build a workflow that listens for new signups, creates a Loops contact with the right user group, and sends the welcome email through Resend with a personalized subject and body so the first impression is on-brand and fast.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['marketing', 'automation', 'communication'],
      alsoIntegrations: ['loops'],
    },
    {
      icon: ResendIcon,
      title: 'Resend domain monitor',
      prompt:
        'Create a scheduled workflow that lists Resend domains, checks DNS verification status for each, and posts a Slack alert the moment any domain shows a verification or DKIM problem so we never silently lose deliverability.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'devops', 'infrastructure'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ResendIcon,
      title: 'Resend transactional flow',
      prompt:
        'Build a workflow that listens for product events, renders the right transactional email body, sends it through Resend, then retrieves the message status after a short delay and writes delivery, open, and click events to a per-user activity table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'communication'],
    },
    {
      icon: ResendIcon,
      title: 'Resend + AgentMail reply handler',
      prompt:
        'Create a workflow that sends outbound messages through Resend but routes replies into a per-customer AgentMail inbox, threads them with the original send, and posts unread inbox digests to the support owner.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'communication', 'automation'],
      alsoIntegrations: ['agentmail'],
    },
    {
      icon: ResendIcon,
      title: 'Resend marketing broadcast',
      prompt:
        'Build a workflow that takes a marketing message and a Resend audience, splits the recipient list into safe-volume batches, sends each batch through Resend with rate-limit pacing, and logs per-batch send results to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
    },
    {
      icon: ResendIcon,
      title: 'Resend audience sync',
      prompt:
        'Create a workflow that reads my subscriber list from a table, creates or updates each Resend contact in the matching audience, and removes contacts that have unsubscribed by deleting them so the Resend audience stays in sync with my source of truth.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation', 'sync'],
    },
    {
      icon: ResendIcon,
      title: 'Resend unsubscribe handler',
      prompt:
        'Build a workflow that listens for unsubscribe events, looks up the matching Resend contact, updates it to unsubscribed, logs the opt-out reason to a table, and sends a confirmation email through Resend acknowledging the change.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'communication', 'compliance'],
    },
  ],
  skills: [
    {
      name: 'send-transactional-email',
      description: 'Send a personalized transactional email and confirm delivery via Resend.',
      content:
        '# Send Transactional Email\n\nSend a one-off transactional email through Resend.\n\n## Steps\n1. Compose the recipient, from address, subject, and HTML or text body, filling in personalization fields.\n2. Run the send operation.\n3. Capture the returned email id.\n4. Optionally run get_email with the id to confirm the delivery status.\n\n## Output\nReturn the email id and delivery status. If sending fails, report the error reason.',
    },
    {
      name: 'add-contact-to-audience',
      description: 'Create or update a Resend contact in an audience for marketing sends.',
      content:
        '# Add Contact To Audience\n\nKeep a Resend audience in sync with new contacts.\n\n## Steps\n1. Run list_contacts or get_contact to check whether the person already exists.\n2. If new, run create_contact with email and name fields and the subscribed state.\n3. If existing, run update_contact to refresh fields.\n4. Confirm the contact is in the correct audience.\n\n## Output\nReturn the contact id and whether it was created or updated.',
    },
    {
      name: 'handle-unsubscribe',
      description: 'Mark a Resend contact as unsubscribed and send a confirmation email.',
      content:
        '# Handle Unsubscribe\n\nProcess an opt-out request cleanly.\n\n## Steps\n1. Run get_contact to look up the matching contact by email.\n2. Run update_contact to set unsubscribed to true.\n3. Log the opt-out reason for compliance records.\n4. Run the send operation to deliver a brief confirmation acknowledging the change.\n\n## Output\nConfirm the contact is unsubscribed and the acknowledgement email id.',
    },
  ],
} as const satisfies BlockMeta
