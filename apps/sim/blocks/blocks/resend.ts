import { ResendIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const ResendBlock: BlockConfig = {
  type: 'resend',
  name: 'Resend',
  description: 'Send emails and manage contacts with Resend.',
  longDescription:
    'Integrate Resend into your workflow. Send emails, retrieve email status, manage contacts, and view domains. Requires API Key.',
  docsLink: 'https://docs.sim.ai/tools/resend',
  category: 'tools',
  bgColor: '#181C1E',
  icon: ResendIcon,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // Email Operations
        { label: 'Send Email', id: 'send_email' },
        { label: 'Get Email', id: 'get_email' },
        // Contact Operations
        { label: 'Create Contact', id: 'create_contact' },
        { label: 'List Contacts', id: 'list_contacts' },
        { label: 'Get Contact', id: 'get_contact' },
        { label: 'Update Contact', id: 'update_contact' },
        { label: 'Delete Contact', id: 'delete_contact' },
        // Domain Operations
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

    // Send Email fields
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

Return ONLY the subject line - no explanations.`,
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

Return ONLY the email body - no explanations.`,
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
    },
    {
      id: 'cc',
      title: 'CC',
      type: 'short-input',
      placeholder: 'cc@example.com',
      condition: { field: 'operation', value: 'send_email' },
    },
    {
      id: 'bcc',
      title: 'BCC',
      type: 'short-input',
      placeholder: 'bcc@example.com',
      condition: { field: 'operation', value: 'send_email' },
    },
    {
      id: 'replyTo',
      title: 'Reply To',
      type: 'short-input',
      placeholder: 'reply@example.com',
      condition: { field: 'operation', value: 'send_email' },
    },
    {
      id: 'scheduledAt',
      title: 'Schedule At',
      type: 'short-input',
      placeholder: '2024-08-05T11:52:01.858Z',
      condition: { field: 'operation', value: 'send_email' },
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'category:welcome,type:onboarding',
      condition: { field: 'operation', value: 'send_email' },
    },

    // Get Email fields
    {
      id: 'emailId',
      title: 'Email ID',
      type: 'short-input',
      placeholder: 'Email ID to retrieve',
      condition: { field: 'operation', value: 'get_email' },
      required: true,
    },

    // Create Contact fields
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
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: ['create_contact', 'update_contact'] },
    },

    // Get/Update/Delete Contact fields
    {
      id: 'contactId',
      title: 'Contact ID or Email',
      type: 'short-input',
      placeholder: 'Contact ID or email address',
      condition: { field: 'operation', value: ['get_contact', 'update_contact', 'delete_contact'] },
      required: true,
    },
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

        if (rest.unsubscribed !== undefined) {
          rest.unsubscribed = rest.unsubscribed === 'true'
        }

        return rest
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    resendApiKey: { type: 'string', description: 'Resend API key' },
    // Send email inputs
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
    // Get email inputs
    emailId: { type: 'string', description: 'Email ID to retrieve' },
    // Contact inputs
    email: { type: 'string', description: 'Contact email address' },
    firstName: { type: 'string', description: 'Contact first name' },
    lastName: { type: 'string', description: 'Contact last name' },
    unsubscribed: { type: 'string', description: 'Contact subscription status' },
    contactId: { type: 'string', description: 'Contact ID or email address' },
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    // Send email outputs
    to: { type: 'string', description: 'Recipient email address' },
    subject: { type: 'string', description: 'Email subject' },
    body: { type: 'string', description: 'Email body content' },
    // Get email outputs
    id: { type: 'string', description: 'Email or contact ID' },
    from: { type: 'string', description: 'Sender email address' },
    html: { type: 'string', description: 'HTML email content' },
    text: { type: 'string', description: 'Plain text email content' },
    lastEvent: { type: 'string', description: 'Last event status' },
    createdAt: { type: 'string', description: 'Creation timestamp' },
    tags: { type: 'json', description: 'Email tags as name-value pairs' },
    // Contact outputs
    email: { type: 'string', description: 'Contact email address' },
    firstName: { type: 'string', description: 'Contact first name' },
    lastName: { type: 'string', description: 'Contact last name' },
    contacts: { type: 'json', description: 'Array of contacts' },
    // Domain outputs
    domains: { type: 'json', description: 'Array of domains' },
    hasMore: { type: 'boolean', description: 'Whether more results are available' },
    deleted: { type: 'boolean', description: 'Whether the resource was deleted' },
  },
}
