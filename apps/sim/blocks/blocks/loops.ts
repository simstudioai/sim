import { LoopsIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { LoopsResponse } from '@/tools/loops/types'

export const LoopsBlock: BlockConfig<LoopsResponse> = {
  type: 'loops',
  name: 'Loops',
  description: 'Manage contacts and send emails with Loops',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Loops into the workflow. Create and manage contacts, send transactional emails, and trigger event-based automations.',
  docsLink: 'https://docs.sim.ai/tools/loops',
  category: 'tools',
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
    // Optional email for update, find, delete, send event
    {
      id: 'contactEmail',
      title: 'Email',
      type: 'short-input',
      placeholder: 'Enter email address',
      condition: {
        field: 'operation',
        value: ['update_contact', 'find_contact', 'delete_contact', 'send_event'],
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
        value: ['update_contact', 'find_contact', 'delete_contact', 'send_event'],
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
}`,
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
}`,
        placeholder: 'Describe the custom properties...',
      },
    },
    // Transactional email fields
    {
      id: 'transactionalId',
      title: 'Transactional Email ID',
      type: 'short-input',
      placeholder: 'Enter template ID (e.g., clx...)',
      required: { field: 'operation', value: 'send_transactional_email' },
      condition: {
        field: 'operation',
        value: 'send_transactional_email',
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
}`,
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
]`,
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
}`,
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
  ],
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
    contacts: { type: 'json', description: 'Array of matching contacts (find operation)' },
    message: { type: 'string', description: 'Status message (delete operation)' },
    mailingLists: {
      type: 'json',
      description: 'Array of mailing lists (list mailing lists operation)',
    },
    transactionalEmails: {
      type: 'json',
      description: 'Array of transactional email templates (list transactional emails operation)',
    },
    pagination: {
      type: 'json',
      description: 'Pagination info (list transactional emails operation)',
    },
    properties: {
      type: 'json',
      description: 'Array of contact properties (list contact properties operation)',
    },
  },
}
