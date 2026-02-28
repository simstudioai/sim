import { GoogleContactsIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { GoogleContactsResponse } from '@/tools/google_contacts/types'

export const GoogleContactsBlock: BlockConfig<GoogleContactsResponse> = {
  type: 'google_contacts',
  name: 'Google Contacts',
  description: 'Manage Google Contacts',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Google Contacts into the workflow. Can create, read, update, delete, list, and search contacts.',
  docsLink: 'https://docs.sim.ai/tools/google_contacts',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: GoogleContactsIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Contact', id: 'create' },
        { label: 'Get Contact', id: 'get' },
        { label: 'List Contacts', id: 'list' },
        { label: 'Search Contacts', id: 'search' },
        { label: 'Update Contact', id: 'update' },
        { label: 'Delete Contact', id: 'delete' },
      ],
      value: () => 'create',
    },
    {
      id: 'credential',
      title: 'Google Contacts Account',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      required: true,
      serviceId: 'google-contacts',
      requiredScopes: ['https://www.googleapis.com/auth/contacts'],
      placeholder: 'Select Google account',
    },
    {
      id: 'manualCredential',
      title: 'Google Contacts Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },

    // Create Contact Fields
    {
      id: 'givenName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'John',
      condition: { field: 'operation', value: ['create', 'update'] },
      required: { field: 'operation', value: 'create' },
    },
    {
      id: 'familyName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Doe',
      condition: { field: 'operation', value: ['create', 'update'] },
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'john@example.com',
      condition: { field: 'operation', value: ['create', 'update'] },
    },
    {
      id: 'emailType',
      title: 'Email Type',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create', 'update'] },
      options: [
        { label: 'Work', id: 'work' },
        { label: 'Home', id: 'home' },
        { label: 'Other', id: 'other' },
      ],
      value: () => 'work',
      mode: 'advanced',
    },
    {
      id: 'phone',
      title: 'Phone',
      type: 'short-input',
      placeholder: '+1234567890',
      condition: { field: 'operation', value: ['create', 'update'] },
    },
    {
      id: 'phoneType',
      title: 'Phone Type',
      type: 'dropdown',
      condition: { field: 'operation', value: ['create', 'update'] },
      options: [
        { label: 'Mobile', id: 'mobile' },
        { label: 'Home', id: 'home' },
        { label: 'Work', id: 'work' },
        { label: 'Other', id: 'other' },
      ],
      value: () => 'mobile',
      mode: 'advanced',
    },
    {
      id: 'organization',
      title: 'Organization',
      type: 'short-input',
      placeholder: 'Acme Corp',
      condition: { field: 'operation', value: ['create', 'update'] },
    },
    {
      id: 'jobTitle',
      title: 'Job Title',
      type: 'short-input',
      placeholder: 'Software Engineer',
      condition: { field: 'operation', value: ['create', 'update'] },
    },
    {
      id: 'notes',
      title: 'Notes',
      type: 'long-input',
      placeholder: 'Additional notes about the contact',
      condition: { field: 'operation', value: ['create', 'update'] },
      mode: 'advanced',
    },

    // Get / Update / Delete Fields
    {
      id: 'resourceName',
      title: 'Resource Name',
      type: 'short-input',
      placeholder: 'people/c1234567890',
      condition: { field: 'operation', value: ['get', 'update', 'delete'] },
      required: { field: 'operation', value: ['get', 'update', 'delete'] },
    },

    // Update requires etag
    {
      id: 'etag',
      title: 'ETag',
      type: 'short-input',
      placeholder: 'ETag from a previous get request',
      condition: { field: 'operation', value: 'update' },
      required: { field: 'operation', value: 'update' },
    },

    // Search Fields
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Search by name, email, phone, or organization',
      condition: { field: 'operation', value: 'search' },
      required: { field: 'operation', value: 'search' },
    },

    // List/Search Fields
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: ['list', 'search'] },
      mode: 'advanced',
    },
    {
      id: 'pageToken',
      title: 'Page Token',
      type: 'short-input',
      placeholder: 'Token from previous list request',
      condition: { field: 'operation', value: 'list' },
      mode: 'advanced',
    },
    {
      id: 'sortOrder',
      title: 'Sort Order',
      type: 'dropdown',
      condition: { field: 'operation', value: 'list' },
      options: [
        { label: 'Last Modified (Descending)', id: 'LAST_MODIFIED_DESCENDING' },
        { label: 'Last Modified (Ascending)', id: 'LAST_MODIFIED_ASCENDING' },
        { label: 'First Name (Ascending)', id: 'FIRST_NAME_ASCENDING' },
        { label: 'Last Name (Ascending)', id: 'LAST_NAME_ASCENDING' },
      ],
      value: () => 'LAST_MODIFIED_DESCENDING',
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'google_contacts_create',
      'google_contacts_get',
      'google_contacts_list',
      'google_contacts_search',
      'google_contacts_update',
      'google_contacts_delete',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'create':
            return 'google_contacts_create'
          case 'get':
            return 'google_contacts_get'
          case 'list':
            return 'google_contacts_list'
          case 'search':
            return 'google_contacts_search'
          case 'update':
            return 'google_contacts_update'
          case 'delete':
            return 'google_contacts_delete'
          default:
            throw new Error(`Invalid Google Contacts operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { oauthCredential, operation, ...rest } = params

        const processedParams: Record<string, any> = { ...rest }

        // Convert pageSize to number if provided
        if (processedParams.pageSize && typeof processedParams.pageSize === 'string') {
          processedParams.pageSize = Number.parseInt(processedParams.pageSize, 10)
        }

        return {
          oauthCredential,
          ...processedParams,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Google Contacts access token' },

    // Create/Update inputs
    givenName: { type: 'string', description: 'First name' },
    familyName: { type: 'string', description: 'Last name' },
    email: { type: 'string', description: 'Email address' },
    emailType: { type: 'string', description: 'Email type' },
    phone: { type: 'string', description: 'Phone number' },
    phoneType: { type: 'string', description: 'Phone type' },
    organization: { type: 'string', description: 'Organization name' },
    jobTitle: { type: 'string', description: 'Job title' },
    notes: { type: 'string', description: 'Notes' },

    // Get/Update/Delete inputs
    resourceName: { type: 'string', description: 'Contact resource name' },
    etag: { type: 'string', description: 'Contact ETag for updates' },

    // Search inputs
    query: { type: 'string', description: 'Search query' },

    // List inputs
    pageSize: { type: 'string', description: 'Number of results' },
    pageToken: { type: 'string', description: 'Pagination token' },
    sortOrder: { type: 'string', description: 'Sort order' },
  },
  outputs: {
    content: { type: 'string', description: 'Operation response content' },
    metadata: { type: 'json', description: 'Contact or contacts metadata' },
  },
}
