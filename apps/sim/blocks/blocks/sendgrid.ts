import { SendgridIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { SendMailResult } from '@/tools/sendgrid/types'

export const SendGridBlock: BlockConfig<SendMailResult> = {
  type: 'sendgrid',
  name: 'SendGrid',
  description: 'Send emails and manage contacts, lists, and templates with SendGrid',
  longDescription:
    'Integrate SendGrid into your workflow. Send transactional emails, manage marketing contacts and lists, and work with email templates. Supports dynamic templates, attachments, and comprehensive contact management.',
  docsLink: 'https://docs.sim.ai/tools/sendgrid',
  category: 'tools',
  bgColor: '#1A82E2',
  icon: SendgridIcon,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // Mail Operations
        { label: 'Send Mail', id: 'send_mail' },
        // Contact Operations
        { label: 'Add Contact', id: 'add_contact' },
        { label: 'Get Contact', id: 'get_contact' },
        { label: 'Search Contacts', id: 'search_contacts' },
        { label: 'Delete Contacts', id: 'delete_contacts' },
        // List Operations
        { label: 'Create List', id: 'create_list' },
        { label: 'Get List', id: 'get_list' },
        { label: 'List All Lists', id: 'list_all_lists' },
        { label: 'Delete List', id: 'delete_list' },
        { label: 'Add Contacts to List', id: 'add_contacts_to_list' },
        { label: 'Remove Contacts from List', id: 'remove_contacts_from_list' },
        // Template Operations
        { label: 'Create Template', id: 'create_template' },
        { label: 'Get Template', id: 'get_template' },
        { label: 'List Templates', id: 'list_templates' },
        { label: 'Delete Template', id: 'delete_template' },
        { label: 'Create Template Version', id: 'create_template_version' },
      ],
      value: () => 'send_mail',
    },
    {
      id: 'apiKey',
      title: 'SendGrid API Key',
      type: 'short-input',
      password: true,
      placeholder: 'Enter your SendGrid API key',
      required: true,
    },
    // Send Mail fields
    {
      id: 'from',
      title: 'From Email',
      type: 'short-input',
      placeholder: 'sender@yourdomain.com',
      condition: { field: 'operation', value: 'send_mail' },
      required: true,
    },
    {
      id: 'fromName',
      title: 'From Name',
      type: 'short-input',
      placeholder: 'Sender Name',
      condition: { field: 'operation', value: 'send_mail' },
    },
    {
      id: 'to',
      title: 'To Email',
      type: 'short-input',
      placeholder: 'recipient@example.com',
      condition: { field: 'operation', value: 'send_mail' },
      required: true,
    },
    {
      id: 'toName',
      title: 'To Name',
      type: 'short-input',
      placeholder: 'Recipient Name',
      condition: { field: 'operation', value: 'send_mail' },
    },
    {
      id: 'mailSubject',
      title: 'Subject',
      type: 'short-input',
      placeholder: 'Email subject (required unless using template)',
      condition: { field: 'operation', value: 'send_mail' },
    },
    {
      id: 'content',
      title: 'Content',
      type: 'long-input',
      placeholder: 'Email body content (required unless using template)',
      condition: { field: 'operation', value: 'send_mail' },
    },
    {
      id: 'contentType',
      title: 'Content Type',
      type: 'dropdown',
      options: [
        { label: 'Plain Text', id: 'text/plain' },
        { label: 'HTML', id: 'text/html' },
      ],
      value: () => 'text/plain',
      condition: { field: 'operation', value: 'send_mail' },
    },
    {
      id: 'cc',
      title: 'CC',
      type: 'short-input',
      placeholder: 'cc@example.com',
      condition: { field: 'operation', value: 'send_mail' },
    },
    {
      id: 'bcc',
      title: 'BCC',
      type: 'short-input',
      placeholder: 'bcc@example.com',
      condition: { field: 'operation', value: 'send_mail' },
    },
    {
      id: 'replyTo',
      title: 'Reply To',
      type: 'short-input',
      placeholder: 'replyto@example.com',
      condition: { field: 'operation', value: 'send_mail' },
    },
    {
      id: 'replyToName',
      title: 'Reply To Name',
      type: 'short-input',
      placeholder: 'Reply To Name',
      condition: { field: 'operation', value: 'send_mail' },
    },
    {
      id: 'mailTemplateId',
      title: 'Template ID',
      type: 'short-input',
      placeholder: 'SendGrid template ID',
      condition: { field: 'operation', value: 'send_mail' },
    },
    {
      id: 'dynamicTemplateData',
      title: 'Dynamic Template Data',
      type: 'code',
      placeholder: '{"name": "John", "order_id": "12345"}',
      condition: { field: 'operation', value: 'send_mail' },
      wandConfig: {
        enabled: true,
        prompt: `Generate SendGrid dynamic template data JSON based on the user's description.

### CONTEXT
{context}

### GUIDELINES
- Return ONLY a valid JSON object starting with { and ending with }
- Include all variables that the template might use
- Use descriptive key names that match template variables
- Values should be sample data or variable references

### EXAMPLE
User: "Order confirmation with customer name, order number, items list, and total"
Output:
{
  "customer_name": "John Doe",
  "order_id": "ORD-12345",
  "items": [
    {"name": "Product A", "quantity": 2, "price": 29.99},
    {"name": "Product B", "quantity": 1, "price": 49.99}
  ],
  "total": "$109.97",
  "order_date": "January 15, 2024"
}

Return ONLY the JSON object.`,
        placeholder: 'Describe the template variables...',
        generationType: 'json-object',
      },
    },
    // File upload (basic mode)
    {
      id: 'attachmentFiles',
      title: 'Attachments',
      type: 'file-upload',
      canonicalParamId: 'attachments',
      placeholder: 'Upload files to attach',
      condition: { field: 'operation', value: 'send_mail' },
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
      condition: { field: 'operation', value: 'send_mail' },
      mode: 'advanced',
      required: false,
    },
    // Contact fields
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'contact@example.com',
      condition: { field: 'operation', value: ['add_contact'] },
      required: true,
    },
    {
      id: 'firstName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'John',
      condition: { field: 'operation', value: ['add_contact'] },
    },
    {
      id: 'lastName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Doe',
      condition: { field: 'operation', value: ['add_contact'] },
    },
    {
      id: 'customFields',
      title: 'Custom Fields',
      type: 'code',
      placeholder: '{"custom_field_1": "value1"}',
      condition: { field: 'operation', value: ['add_contact'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate SendGrid custom fields JSON based on the user's description.

### CONTEXT
{context}

### GUIDELINES
- Return ONLY a valid JSON object starting with { and ending with }
- Use the custom field IDs defined in your SendGrid account
- Custom field IDs are typically like "e1_T" or similar format
- Include appropriate values for each custom field

### EXAMPLE
User: "Add company name and signup source as custom fields"
Output:
{
  "e1_T": "Acme Corporation",
  "e2_T": "website_signup"
}

Return ONLY the JSON object.`,
        placeholder: 'Describe the custom field values...',
        generationType: 'json-object',
      },
    },
    {
      id: 'contactListIds',
      title: 'List IDs',
      type: 'short-input',
      placeholder: 'Comma-separated list IDs',
      condition: { field: 'operation', value: ['add_contact'] },
    },
    {
      id: 'contactId',
      title: 'Contact ID',
      type: 'short-input',
      placeholder: 'Contact ID',
      condition: { field: 'operation', value: ['get_contact'] },
      required: true,
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      placeholder: "email LIKE '%example.com%'",
      condition: { field: 'operation', value: ['search_contacts'] },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a SendGrid contact search query (SGQL) based on the user's description.

### CONTEXT
{context}

### GUIDELINES
- Use SendGrid Query Language (SGQL) syntax
- Available operators: LIKE, NOT LIKE, IS, IS NOT, IN, NOT IN, BETWEEN
- Available fields: email, first_name, last_name, created_at, updated_at, and custom fields
- Use AND/OR for combining conditions
- Use single quotes for string values

### EXAMPLE
User: "Find all contacts from gmail addresses added in the last 30 days"
Output: email LIKE '%@gmail.com' AND created_at > TIMESTAMP '2024-01-01'

Return ONLY the SGQL query.`,
        placeholder: 'Describe the search criteria...',
      },
    },
    {
      id: 'contactIds',
      title: 'Contact IDs',
      type: 'short-input',
      placeholder: 'Comma-separated contact IDs',
      condition: {
        field: 'operation',
        value: ['delete_contacts', 'remove_contacts_from_list'],
      },
      required: true,
    },
    {
      id: 'contacts',
      title: 'Contacts (JSON Array)',
      type: 'code',
      placeholder: '[{"email": "user@example.com", "first_name": "John"}]',
      condition: { field: 'operation', value: 'add_contacts_to_list' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of SendGrid contacts based on the user's description.

### CONTEXT
{context}

### GUIDELINES
- Return ONLY a valid JSON array starting with [ and ending with ]
- Each contact must have an "email" field
- Optional fields: first_name, last_name, custom_fields
- For custom fields, use the field ID format (e.g., "e1_T")

### EXAMPLE
User: "Add 3 contacts from the marketing team"
Output:
[
  {"email": "alice@company.com", "first_name": "Alice", "last_name": "Smith"},
  {"email": "bob@company.com", "first_name": "Bob", "last_name": "Jones"},
  {"email": "carol@company.com", "first_name": "Carol", "last_name": "Williams"}
]

Return ONLY the JSON array.`,
        placeholder: 'Describe the contacts to add...',
        generationType: 'json-object',
      },
    },
    // List fields
    {
      id: 'listName',
      title: 'List Name',
      type: 'short-input',
      placeholder: 'List name',
      condition: { field: 'operation', value: ['create_list'] },
      required: true,
    },
    {
      id: 'listId',
      title: 'List ID',
      type: 'short-input',
      placeholder: 'List ID',
      condition: {
        field: 'operation',
        value: ['get_list', 'delete_list', 'add_contacts_to_list', 'remove_contacts_from_list'],
      },
      required: true,
    },
    {
      id: 'listPageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'list_all_lists' },
    },
    // Template fields
    {
      id: 'templateName',
      title: 'Template Name',
      type: 'short-input',
      placeholder: 'Template name',
      condition: { field: 'operation', value: ['create_template'] },
      required: true,
    },
    {
      id: 'templateId',
      title: 'Template ID',
      type: 'short-input',
      placeholder: 'Template ID',
      condition: {
        field: 'operation',
        value: ['get_template', 'delete_template', 'create_template_version'],
      },
      required: true,
    },
    {
      id: 'generation',
      title: 'Template Generation',
      type: 'dropdown',
      options: [
        { label: 'Dynamic', id: 'dynamic' },
        { label: 'Legacy', id: 'legacy' },
      ],
      value: () => 'dynamic',
      condition: { field: 'operation', value: 'create_template' },
    },
    {
      id: 'templateGenerations',
      title: 'Filter by Generation',
      type: 'short-input',
      placeholder: 'legacy, dynamic, or both',
      condition: { field: 'operation', value: 'list_templates' },
    },
    {
      id: 'templatePageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: 'list_templates' },
    },
    {
      id: 'versionName',
      title: 'Version Name',
      type: 'short-input',
      placeholder: 'Version name',
      condition: { field: 'operation', value: 'create_template_version' },
      required: true,
    },
    {
      id: 'templateSubject',
      title: 'Template Subject',
      type: 'short-input',
      placeholder: 'Email subject',
      condition: { field: 'operation', value: 'create_template_version' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Generate an email subject line for a SendGrid template based on the user's description.

### CONTEXT
{context}

### GUIDELINES
- Keep it concise (under 60 characters for best deliverability)
- Use Handlebars variables: {{variable_name}}
- Make it clear and descriptive
- Avoid spam trigger words

### EXAMPLE
User: "Order shipped notification with order number"
Output: Your order #{{order_id}} has shipped!

Return ONLY the subject line.`,
        placeholder: 'Describe the template subject...',
      },
    },
    {
      id: 'htmlContent',
      title: 'HTML Content',
      type: 'code',
      placeholder: '<html><body>{{name}}</body></html>',
      condition: { field: 'operation', value: 'create_template_version' },
      wandConfig: {
        enabled: true,
        prompt: `Generate SendGrid email template HTML based on the user's description.

### CONTEXT
{context}

### GUIDELINES
- Return valid HTML for email (use tables for layout, inline CSS)
- Use Handlebars syntax for dynamic content: {{variable_name}}
- Use conditionals: {{#if variable}}...{{/if}}
- Use loops: {{#each items}}...{{/each}}
- Include proper HTML structure with doctype
- Make it mobile-responsive

### EXAMPLE
User: "Simple order confirmation template with customer name and order details"
Output:
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; }
    .header { background: #007bff; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Order Confirmation</h1>
    </div>
    <div class="content">
      <p>Hi {{customer_name}},</p>
      <p>Thank you for your order #{{order_id}}!</p>
      <p>Total: {{total}}</p>
    </div>
  </div>
</body>
</html>

Return ONLY the HTML content.`,
        placeholder: 'Describe the email template...',
      },
    },
    {
      id: 'plainContent',
      title: 'Plain Text Content',
      type: 'long-input',
      placeholder: 'Plain text content',
      condition: { field: 'operation', value: 'create_template_version' },
    },
    {
      id: 'active',
      title: 'Active',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'true',
      condition: { field: 'operation', value: 'create_template_version' },
    },
  ],

  tools: {
    access: [
      'sendgrid_send_mail',
      'sendgrid_add_contact',
      'sendgrid_get_contact',
      'sendgrid_search_contacts',
      'sendgrid_delete_contacts',
      'sendgrid_create_list',
      'sendgrid_get_list',
      'sendgrid_list_all_lists',
      'sendgrid_delete_list',
      'sendgrid_add_contacts_to_list',
      'sendgrid_remove_contacts_from_list',
      'sendgrid_create_template',
      'sendgrid_get_template',
      'sendgrid_list_templates',
      'sendgrid_delete_template',
      'sendgrid_create_template_version',
    ],
    config: {
      tool: (params) => `sendgrid_${params.operation}`,
      params: (params) => {
        const {
          operation,
          mailSubject,
          mailTemplateId,
          listName,
          templateName,
          versionName,
          templateSubject,
          contactListIds,
          templateGenerations,
          listPageSize,
          templatePageSize,
          attachments,
          ...rest
        } = params

        // Normalize attachments for send_mail operation
        const normalizedAttachments = normalizeFileInput(attachments)

        // Map renamed fields back to tool parameter names
        return {
          ...rest,
          ...(mailSubject && { subject: mailSubject }),
          ...(mailTemplateId && { templateId: mailTemplateId }),
          ...(listName && { name: listName }),
          ...(templateName && { name: templateName }),
          ...(versionName && { name: versionName }),
          ...(templateSubject && { subject: templateSubject }),
          ...(contactListIds && { listIds: contactListIds }),
          ...(templateGenerations && { generations: templateGenerations }),
          ...(listPageSize && { pageSize: listPageSize }),
          ...(templatePageSize && { pageSize: templatePageSize }),
          ...(normalizedAttachments && { attachments: normalizedAttachments }),
        }
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'SendGrid API key' },
    // Mail inputs
    from: { type: 'string', description: 'Sender email address' },
    fromName: { type: 'string', description: 'Sender name' },
    to: { type: 'string', description: 'Recipient email address' },
    toName: { type: 'string', description: 'Recipient name' },
    mailSubject: { type: 'string', description: 'Email subject' },
    content: { type: 'string', description: 'Email content' },
    contentType: { type: 'string', description: 'Content type' },
    cc: { type: 'string', description: 'CC email address' },
    bcc: { type: 'string', description: 'BCC email address' },
    replyTo: { type: 'string', description: 'Reply-to email address' },
    replyToName: { type: 'string', description: 'Reply-to name' },
    mailTemplateId: { type: 'string', description: 'Template ID for sending mail' },
    dynamicTemplateData: { type: 'json', description: 'Dynamic template data' },
    attachments: { type: 'array', description: 'Files to attach (canonical param)' },
    // Contact inputs
    email: { type: 'string', description: 'Contact email' },
    firstName: { type: 'string', description: 'Contact first name' },
    lastName: { type: 'string', description: 'Contact last name' },
    customFields: { type: 'json', description: 'Custom fields' },
    contactId: { type: 'string', description: 'Contact ID' },
    contactIds: { type: 'string', description: 'Comma-separated contact IDs' },
    contacts: { type: 'json', description: 'Array of contact objects' },
    query: { type: 'string', description: 'Search query' },
    contactListIds: { type: 'string', description: 'Comma-separated list IDs for contact' },
    // List inputs
    listName: { type: 'string', description: 'List name' },
    listId: { type: 'string', description: 'List ID' },
    listPageSize: { type: 'number', description: 'Page size for listing lists' },
    // Template inputs
    templateName: { type: 'string', description: 'Template name' },
    templateId: { type: 'string', description: 'Template ID' },
    generation: { type: 'string', description: 'Template generation' },
    templateGenerations: { type: 'string', description: 'Filter templates by generation' },
    templatePageSize: { type: 'number', description: 'Page size for listing templates' },
    versionName: { type: 'string', description: 'Template version name' },
    templateSubject: { type: 'string', description: 'Template subject' },
    htmlContent: { type: 'string', description: 'HTML content' },
    plainContent: { type: 'string', description: 'Plain text content' },
    active: { type: 'boolean', description: 'Whether template version is active' },
  },

  outputs: {
    // Common
    success: { type: 'boolean', description: 'Operation success status' },
    message: { type: 'string', description: 'Status or success message' },
    // Send mail outputs
    messageId: { type: 'string', description: 'Email message ID (send_mail)' },
    to: { type: 'string', description: 'Recipient email address (send_mail)' },
    subject: { type: 'string', description: 'Email subject (send_mail, create_template_version)' },
    // Contact outputs
    id: { type: 'string', description: 'Resource ID' },
    jobId: { type: 'string', description: 'Job ID for async operations' },
    email: { type: 'string', description: 'Contact email address' },
    firstName: { type: 'string', description: 'Contact first name' },
    lastName: { type: 'string', description: 'Contact last name' },
    createdAt: { type: 'string', description: 'Creation timestamp' },
    updatedAt: { type: 'string', description: 'Last update timestamp' },
    listIds: { type: 'json', description: 'Array of list IDs the contact belongs to' },
    customFields: { type: 'json', description: 'Custom field values' },
    contacts: { type: 'json', description: 'Array of contacts' },
    contactCount: { type: 'number', description: 'Number of contacts' },
    // List outputs
    lists: { type: 'json', description: 'Array of lists' },
    name: { type: 'string', description: 'Resource name' },
    // Template outputs
    templates: { type: 'json', description: 'Array of templates' },
    generation: { type: 'string', description: 'Template generation' },
    versions: { type: 'json', description: 'Array of template versions' },
    // Template version outputs
    templateId: { type: 'string', description: 'Template ID' },
    active: { type: 'boolean', description: 'Whether template version is active' },
    htmlContent: { type: 'string', description: 'HTML content' },
    plainContent: { type: 'string', description: 'Plain text content' },
  },
}
