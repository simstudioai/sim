import { LoopsIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { LoopsResponse } from '@/tools/loops/types'
import { getTrigger } from '@/triggers'

export const LoopsBlock: BlockConfig<LoopsResponse> = {
  type: 'loops',
  name: 'Loops',
  description: 'Manage contacts and send emails with Loops',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Loops into the workflow. Create and manage contacts, send transactional emails, and trigger event-based automations.',
  docsLink: 'https://docs.sim.ai/integrations/loops',
  category: 'tools',
  integrationType: IntegrationType.Email,
  bgColor: '#FAFAF9',
  icon: LoopsIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Contact', id: 'create_contact' },
        { label: 'Update Contact', id: 'update_contact' },
        { label: 'Find Contact', id: 'find_contact' },
        { label: 'Delete Contact', id: 'delete_contact' },
        { label: 'Send Transactional Email', id: 'send_transactional_email' },
        { label: 'Send Event', id: 'send_event' },
        { label: 'List Mailing Lists', id: 'list_mailing_lists' },
        { label: 'List Transactional Emails', id: 'list_transactional_emails' },
        { label: 'Create Contact Property', id: 'create_contact_property' },
        { label: 'List Contact Properties', id: 'list_contact_properties' },
        { label: 'Check Contact Suppression', id: 'check_contact_suppression' },
        { label: 'Remove Contact Suppression', id: 'remove_contact_suppression' },
        { label: 'Get Transactional Email', id: 'get_transactional_email' },
      ],
      value: () => 'create_contact',
    },
    // Required email for create and send transactional
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'Enter email address',
      required: true,
      condition: {
        field: 'operation',
        value: ['create_contact', 'send_transactional_email'],
      },
    },
    // Optional email for update, find, delete, send event, suppression lookups
    {
      id: 'contactEmail',
      title: 'Email',
      type: 'short-input',
      placeholder: 'Enter email address',
      condition: {
        field: 'operation',
        value: [
          'update_contact',
          'find_contact',
          'delete_contact',
          'send_event',
          'check_contact_suppression',
          'remove_contact_suppression',
        ],
      },
    },
    // User ID for operations that support it
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'Enter user ID',
      condition: {
        field: 'operation',
        value: [
          'update_contact',
          'find_contact',
          'delete_contact',
          'send_event',
          'check_contact_suppression',
          'remove_contact_suppression',
        ],
      },
    },
    // Contact fields
    {
      id: 'firstName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'Enter first name',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact'],
      },
    },
    {
      id: 'lastName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Enter last name',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact'],
      },
    },
    // Advanced contact fields
    {
      id: 'source',
      title: 'Source',
      type: 'short-input',
      placeholder: 'Custom source (default: "API")',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact'],
      },
      mode: 'advanced',
    },
    {
      id: 'subscribed',
      title: 'Subscribed',
      type: 'switch',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact'],
      },
      mode: 'advanced',
    },
    {
      id: 'userGroup',
      title: 'User Group',
      type: 'short-input',
      placeholder: 'Enter user group',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact'],
      },
      mode: 'advanced',
    },
    {
      id: 'createUserId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'Enter unique user ID',
      condition: {
        field: 'operation',
        value: 'create_contact',
      },
      mode: 'advanced',
    },
    {
      id: 'mailingLists',
      title: 'Mailing Lists',
      type: 'long-input',
      placeholder: '{"listId123": true, "listId456": false}',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact', 'send_event'],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object mapping Loops mailing list IDs to boolean values. Use true to subscribe the contact to a list and false to unsubscribe.

Current value: {context}

The output must be a valid JSON object with string keys (mailing list IDs) and boolean values.

Example:
{
  "clxf1nxlb000t0ml79ajwcsj0": true,
  "clxf2q43u00010mlh12q9ggx1": false
}

Return ONLY the JSON object - no explanations, no extra text.`,
        placeholder: 'Describe the mailing list subscriptions...',
      },
    },
    {
      id: 'customProperties',
      title: 'Custom Properties',
      type: 'long-input',
      placeholder: '{"plan": "pro", "company": "Acme"}',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact'],
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object of custom contact properties for Loops. Values can be strings, numbers, booleans, or ISO 8601 date strings. Send null to reset a property.

Current value: {context}

The output must be a valid JSON object.

Example:
{
  "plan": "pro",
  "company": "Acme Inc",
  "signupDate": "2024-01-15T00:00:00Z",
  "isActive": true,
  "seats": 5
}

Return ONLY the JSON object - no explanations, no extra text.`,
        placeholder: 'Describe the custom properties...',
      },
    },
    // Transactional email fields
    {
      id: 'transactionalId',
      title: 'Transactional Email ID',
      type: 'short-input',
      placeholder: 'Enter template ID (e.g., clx...)',
      required: {
        field: 'operation',
        value: ['send_transactional_email', 'get_transactional_email'],
      },
      condition: {
        field: 'operation',
        value: ['send_transactional_email', 'get_transactional_email'],
      },
    },
    {
      id: 'dataVariables',
      title: 'Data Variables',
      type: 'long-input',
      placeholder: '{"name": "John", "url": "https://..."}',
      condition: {
        field: 'operation',
        value: 'send_transactional_email',
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object of data variables for a Loops transactional email template. Values must be strings or numbers, matching the variable names defined in the template.

Current value: {context}

The output must be a valid JSON object with string keys.

Example:
{
  "name": "John Smith",
  "confirmationUrl": "https://example.com/confirm?token=abc123",
  "expiresIn": 24
}

Return ONLY the JSON object - no explanations, no extra text.`,
        placeholder: 'Describe the template variables...',
      },
    },
    {
      id: 'addToAudience',
      title: 'Add to Audience',
      type: 'switch',
      condition: {
        field: 'operation',
        value: 'send_transactional_email',
      },
      mode: 'advanced',
    },
    {
      id: 'attachments',
      title: 'Attachments',
      type: 'long-input',
      placeholder:
        '[{"filename": "file.pdf", "contentType": "application/pdf", "data": "base64..."}]',
      condition: {
        field: 'operation',
        value: 'send_transactional_email',
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of file attachments for a Loops transactional email. Each object must have: filename (string), contentType (MIME type string), and data (base64-encoded file content string).

Current value: {context}

The output must be a valid JSON array.

Example:
[
  {
    "filename": "invoice.pdf",
    "contentType": "application/pdf",
    "data": "JVBERi0xLjQK..."
  }
]

Return ONLY the JSON array - no explanations, no extra text.`,
        placeholder: 'Describe the attachments...',
      },
    },
    // Event fields
    {
      id: 'eventName',
      title: 'Event Name',
      type: 'short-input',
      placeholder: 'Enter event name (e.g., signup_completed)',
      required: { field: 'operation', value: 'send_event' },
      condition: {
        field: 'operation',
        value: 'send_event',
      },
    },
    {
      id: 'eventProperties',
      title: 'Event Properties',
      type: 'long-input',
      placeholder: '{"plan": "pro", "amount": 49.99}',
      condition: {
        field: 'operation',
        value: 'send_event',
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object of event properties for a Loops event. Values can be strings, numbers, booleans, or ISO 8601 date strings.

Current value: {context}

The output must be a valid JSON object.

Example:
{
  "plan": "pro",
  "amount": 49.99,
  "currency": "USD",
  "isUpgrade": true
}

Return ONLY the JSON object - no explanations, no extra text.`,
        placeholder: 'Describe the event properties...',
      },
    },
    // List transactional emails pagination fields
    {
      id: 'perPage',
      title: 'Results Per Page',
      type: 'short-input',
      placeholder: '20 (range: 10-50)',
      condition: {
        field: 'operation',
        value: 'list_transactional_emails',
      },
      mode: 'advanced',
    },
    {
      id: 'cursor',
      title: 'Pagination Cursor',
      type: 'short-input',
      placeholder: 'Cursor from previous response',
      condition: {
        field: 'operation',
        value: 'list_transactional_emails',
      },
      mode: 'advanced',
    },
    // Create contact property fields
    {
      id: 'propertyName',
      title: 'Property Name',
      type: 'short-input',
      placeholder: 'Enter property name in camelCase (e.g., favoriteColor)',
      required: { field: 'operation', value: 'create_contact_property' },
      condition: {
        field: 'operation',
        value: 'create_contact_property',
      },
    },
    {
      id: 'propertyType',
      title: 'Property Type',
      type: 'dropdown',
      options: [
        { label: 'String', id: 'string' },
        { label: 'Number', id: 'number' },
        { label: 'Boolean', id: 'boolean' },
        { label: 'Date', id: 'date' },
      ],
      value: () => 'string',
      condition: {
        field: 'operation',
        value: 'create_contact_property',
      },
    },
    // List contact properties filter
    {
      id: 'propertyFilter',
      title: 'Filter',
      type: 'dropdown',
      options: [
        { label: 'All Properties', id: 'all' },
        { label: 'Custom Only', id: 'custom' },
      ],
      value: () => 'all',
      condition: {
        field: 'operation',
        value: 'list_contact_properties',
      },
      mode: 'advanced',
    },
    // API Key (always visible)
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Loops API key',
      password: true,
      required: true,
    },
    ...getTrigger('loops_email_delivered').subBlocks,
    ...getTrigger('loops_email_opened').subBlocks,
    ...getTrigger('loops_email_clicked').subBlocks,
    ...getTrigger('loops_email_hard_bounced').subBlocks,
    ...getTrigger('loops_email_soft_bounced').subBlocks,
    ...getTrigger('loops_campaign_email_sent').subBlocks,
    ...getTrigger('loops_loop_email_sent').subBlocks,
    ...getTrigger('loops_transactional_email_sent').subBlocks,
  ],
  triggers: {
    enabled: true,
    available: [
      'loops_email_delivered',
      'loops_email_opened',
      'loops_email_clicked',
      'loops_email_hard_bounced',
      'loops_email_soft_bounced',
      'loops_campaign_email_sent',
      'loops_loop_email_sent',
      'loops_transactional_email_sent',
    ],
  },
  tools: {
    access: [
      'loops_create_contact',
      'loops_update_contact',
      'loops_find_contact',
      'loops_delete_contact',
      'loops_send_transactional_email',
      'loops_send_event',
      'loops_list_mailing_lists',
      'loops_list_transactional_emails',
      'loops_create_contact_property',
      'loops_list_contact_properties',
      'loops_check_contact_suppression',
      'loops_remove_contact_suppression',
      'loops_get_transactional_email',
    ],
    config: {
      tool: (params) => `loops_${params.operation}`,
      params: (params) => {
        const { operation, apiKey } = params
        const result: Record<string, unknown> = { apiKey }

        switch (operation) {
          case 'create_contact':
            result.email = params.email
            if (params.firstName) result.firstName = params.firstName
            if (params.lastName) result.lastName = params.lastName
            if (params.source) result.source = params.source
            if (params.subscribed != null) result.subscribed = params.subscribed
            if (params.userGroup) result.userGroup = params.userGroup
            if (params.createUserId) result.userId = params.createUserId
            if (params.mailingLists) result.mailingLists = params.mailingLists
            if (params.customProperties) result.customProperties = params.customProperties
            break

          case 'update_contact':
            if (params.contactEmail) result.email = params.contactEmail
            if (params.userId) result.userId = params.userId
            if (params.firstName) result.firstName = params.firstName
            if (params.lastName) result.lastName = params.lastName
            if (params.source) result.source = params.source
            if (params.subscribed != null) result.subscribed = params.subscribed
            if (params.userGroup) result.userGroup = params.userGroup
            if (params.mailingLists) result.mailingLists = params.mailingLists
            if (params.customProperties) result.customProperties = params.customProperties
            break

          case 'find_contact':
            if (params.contactEmail) result.email = params.contactEmail
            if (params.userId) result.userId = params.userId
            break

          case 'delete_contact':
            if (params.contactEmail) result.email = params.contactEmail
            if (params.userId) result.userId = params.userId
            break

          case 'send_transactional_email':
            result.email = params.email
            result.transactionalId = params.transactionalId
            if (params.dataVariables) result.dataVariables = params.dataVariables
            if (params.addToAudience != null) result.addToAudience = params.addToAudience
            if (params.attachments) result.attachments = params.attachments
            break

          case 'send_event':
            if (params.contactEmail) result.email = params.contactEmail
            if (params.userId) result.userId = params.userId
            result.eventName = params.eventName
            if (params.eventProperties) result.eventProperties = params.eventProperties
            if (params.mailingLists) result.mailingLists = params.mailingLists
            break

          case 'list_transactional_emails':
            if (params.perPage) result.perPage = params.perPage
            if (params.cursor) result.cursor = params.cursor
            break

          case 'create_contact_property':
            result.name = params.propertyName
            result.type = params.propertyType
            break

          case 'list_contact_properties':
            if (params.propertyFilter) result.list = params.propertyFilter
            break

          case 'check_contact_suppression':
          case 'remove_contact_suppression':
            if (params.contactEmail) result.email = params.contactEmail
            if (params.userId) result.userId = params.userId
            break

          case 'get_transactional_email':
            result.transactionalId = params.transactionalId
            break
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    email: { type: 'string', description: 'Contact email address' },
    contactEmail: { type: 'string', description: 'Contact email for lookup operations' },
    userId: { type: 'string', description: 'Contact user ID' },
    firstName: { type: 'string', description: 'Contact first name' },
    lastName: { type: 'string', description: 'Contact last name' },
    source: { type: 'string', description: 'Contact source' },
    subscribed: { type: 'boolean', description: 'Subscription status' },
    userGroup: { type: 'string', description: 'Contact user group' },
    createUserId: { type: 'string', description: 'User ID for new contact' },
    mailingLists: { type: 'json', description: 'Mailing list subscriptions' },
    customProperties: { type: 'json', description: 'Custom contact properties' },
    transactionalId: { type: 'string', description: 'Transactional email template ID' },
    dataVariables: { type: 'json', description: 'Template data variables' },
    addToAudience: { type: 'boolean', description: 'Add recipient to audience' },
    attachments: { type: 'json', description: 'Email file attachments' },
    eventName: { type: 'string', description: 'Event name' },
    eventProperties: { type: 'json', description: 'Event properties' },
    perPage: { type: 'string', description: 'Results per page for pagination' },
    cursor: { type: 'string', description: 'Pagination cursor' },
    propertyName: { type: 'string', description: 'Contact property name (camelCase)' },
    propertyType: { type: 'string', description: 'Contact property data type' },
    propertyFilter: { type: 'string', description: 'Filter for listing properties' },
    apiKey: { type: 'string', description: 'Loops API key' },
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
    id: { type: 'string', description: 'Contact ID (create/update operations)' },
    contacts: {
      type: 'json',
      description:
        'Array of matching contacts (id, email, firstName, lastName, source, subscribed, userGroup, userId, mailingLists, optInStatus)',
    },
    message: { type: 'string', description: 'Status message (delete operation)' },
    mailingLists: {
      type: 'json',
      description: 'Array of mailing lists (id, name, description, isPublic)',
    },
    transactionalEmails: {
      type: 'json',
      description:
        'Array of transactional email templates (id, name, createdAt, updatedAt, dataVariables)',
    },
    pagination: {
      type: 'json',
      description:
        'Pagination info (totalResults, returnedResults, perPage, totalPages, nextCursor, nextPage)',
    },
    properties: {
      type: 'json',
      description: 'Array of contact properties (key, label, type)',
    },
    isSuppressed: {
      type: 'boolean',
      description: 'Whether the contact is on the suppression list (check suppression)',
    },
    contactId: {
      type: 'string',
      description: 'The Loops-assigned contact ID (check suppression)',
    },
    removalQuotaLimit: {
      type: 'number',
      description: 'Total suppression-removal quota for the team',
    },
    removalQuotaRemaining: {
      type: 'number',
      description: 'Remaining suppression-removal quota for the team',
    },
    name: {
      type: 'string',
      description: 'Transactional email template name (get transactional email)',
    },
    draftEmailMessageId: {
      type: 'string',
      description: 'ID of the draft email message, if any (get transactional email)',
    },
    publishedEmailMessageId: {
      type: 'string',
      description: 'ID of the published email message, if any (get transactional email)',
    },
    transactionalGroupId: {
      type: 'string',
      description: 'ID of the transactional group, if any (get transactional email)',
    },
    createdAt: {
      type: 'string',
      description: 'Creation timestamp (get transactional email)',
    },
    updatedAt: {
      type: 'string',
      description: 'Last updated timestamp (get transactional email)',
    },
    dataVariables: {
      type: 'json',
      description: 'Template data variable names (get transactional email)',
    },
  },
}

export const LoopsBlockMeta = {
  tags: ['email-marketing', 'marketing', 'automation'],
  url: 'https://loops.so',
  templates: [
    {
      icon: LoopsIcon,
      title: 'Loops product event tracker',
      prompt:
        'Build a workflow that listens for product events from my tables, sends matching Loops events for each user with structured properties, and updates contact properties so Loops automations can branch on real product behavior.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation', 'product'],
    },
    {
      icon: LoopsIcon,
      title: 'Loops list hygiene',
      prompt:
        'Create a scheduled workflow that reads a Sim table of user activity to find accounts inactive for 90 days, updates each contact in Loops to the dormant user group and unsubscribes them from non-essential mailing lists, and writes a hygiene report to a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation', 'analysis'],
    },
    {
      icon: LoopsIcon,
      title: 'Loops onboarding orchestrator',
      prompt:
        'Build a workflow triggered on signup that creates a Loops contact, kicks off the onboarding event sequence, and updates user group as the user completes activation steps so the right Loops email goes out at every milestone.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation', 'communication'],
    },
    {
      icon: LoopsIcon,
      title: 'Loops contact property enricher',
      prompt:
        'Create a scheduled workflow that reads a Sim table of contacts missing key custom properties, enriches each one using Clay or web research, updates the matching contact in Loops with the new properties, and tracks enrichment coverage in a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'crm', 'sync'],
      alsoIntegrations: ['clay'],
    },
    {
      icon: LoopsIcon,
      title: 'Loops signup welcome flow',
      prompt:
        'Build a workflow that on a new product signup creates the contact in Loops with their plan and source, sends a transactional welcome email, and fires a signup event so the onboarding campaign starts automatically.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation', 'communication'],
    },
    {
      icon: LoopsIcon,
      title: 'Loops milestone event sender',
      prompt:
        'Create a workflow that watches product usage in a table for key milestones — first integration, team invite, plan upgrade — and sends the matching Loops event for each so lifecycle emails fire on real behavior instead of guesses.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation', 'product'],
    },
    {
      icon: LoopsIcon,
      title: 'Loops churn win-back',
      prompt:
        'Build a scheduled workflow that reads a Sim table of product-usage data to identify users who have gone inactive, sends each a personalized transactional win-back email through Loops, fires a re-engagement event, and logs who was contacted to a table for follow-up.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation', 'communication'],
    },
  ],
  skills: [
    {
      name: 'onboard-new-contact',
      description: 'Create a Loops contact on signup and send a transactional welcome email.',
      content:
        '# Onboard New Contact\n\nAdd a new signup to Loops and welcome them.\n\n## Steps\n1. Create Contact with the email, first and last name, and any source or user group, plus custom properties like plan.\n2. Send Transactional Email using the welcome template ID, passing the contact data as data variables.\n3. Optionally Send Event with a signup event name so any onboarding automation begins.\n\n## Output\nThe created contact ID, confirmation the welcome email was sent, and any event fired.',
    },
    {
      name: 'send-product-event',
      description:
        'Fire a Loops event for a user with structured properties to trigger lifecycle automations.',
      content:
        '# Send Product Event\n\nDrive Loops automations from real product behavior.\n\n## Steps\n1. Identify the contact by email or user ID and the event that occurred.\n2. Build event properties as a JSON object with the relevant values, such as plan and amount.\n3. Send Event with the event name, the contact identifier, and the properties.\n4. Optionally update mailing list subscriptions in the same call.\n\n## Output\nConfirmation the event was sent, the contact it was attributed to, and the properties included.',
    },
    {
      name: 'enrich-contact-properties',
      description:
        'Find a Loops contact and update it with enriched custom properties and user group.',
      content:
        '# Enrich Contact Properties\n\nKeep Loops contact data complete and current.\n\n## Steps\n1. Find Contact by email or user ID to read existing fields and spot gaps.\n2. Gather the missing or stale values from your source or research.\n3. Update Contact with the new custom properties, user group, and any name fields.\n\n## Output\nThe updated contact ID and a summary of the properties that were set or changed.',
    },
    {
      name: 'send-transactional-email',
      description:
        'Send a Loops transactional email from a template with personalized data variables.',
      content:
        '# Send Transactional Email\n\nDeliver a templated transactional email through Loops.\n\n## Steps\n1. Confirm the transactional email template ID to use.\n2. Build the data variables JSON to match the variable names in the template, such as name and a confirmation URL.\n3. Send Transactional Email with the recipient email, template ID, and data variables, attaching files if needed.\n\n## Output\nConfirmation of send success and the template ID and recipient used.',
    },
    {
      name: 'manage-suppression-compliance',
      description:
        'Check and clear Loops suppression status for a contact to keep deliverability and unsubscribe compliance in check.',
      content:
        '# Manage Suppression Compliance\n\nKeep Loops sending compliant and deliverable.\n\n## Steps\n1. Check Contact Suppression by email or user ID to see if the contact bounced, complained, or unsubscribed.\n2. If the contact should be re-enabled (e.g. a confirmed re-opt-in), Remove Contact Suppression for the same identifier, noting the remaining removal quota.\n3. Log the result so support and compliance workflows have an audit trail.\n\n## Output\nThe suppression status before and after the change, plus the remaining removal quota.',
    },
  ],
} as const satisfies BlockMeta
