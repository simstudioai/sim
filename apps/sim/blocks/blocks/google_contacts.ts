import { GoogleContactsIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import { GoogleContactsBlockDisplay } from '@/blocks/blocks/google_contacts.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { SERVICE_ACCOUNT_SUBBLOCKS } from '@/blocks/utils'
import type { GoogleContactsResponse } from '@/tools/google_contacts/types'

export const GoogleContactsBlock: BlockConfig<GoogleContactsResponse> = {
  ...GoogleContactsBlockDisplay,
  authMode: AuthMode.OAuth,
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
      requiredScopes: getScopesForService('google-contacts'),
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
    ...SERVICE_ACCOUNT_SUBBLOCKS,

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

export const GoogleContactsBlockMeta = {
  tags: ['google-workspace', 'customer-support', 'enrichment'],
  url: 'https://contacts.google.com',
  templates: [
    {
      icon: GoogleContactsIcon,
      title: 'Google Contacts CRM sync',
      prompt:
        'Build a scheduled workflow that mirrors Google Contacts into HubSpot, adding new contacts and updating fields, and writing a sync log for hygiene tracking.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'sync'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: GoogleContactsIcon,
      title: 'Google Contacts duplicate cleaner',
      prompt:
        'Create a scheduled workflow that scans Google Contacts for duplicates, merges them deterministically, and writes a cleanup report for review.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'automation'],
    },
    {
      icon: GoogleContactsIcon,
      title: 'Google Contacts enricher',
      prompt:
        'Build a scheduled workflow that scans Google Contacts for entries missing company or title, enriches each via Apollo, and writes the enriched contact back to Google Contacts.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['apollo'],
    },
    {
      icon: GoogleContactsIcon,
      title: 'Google Contacts + Calendar grouper',
      prompt:
        'Create a workflow that groups Google Contacts into labels based on meeting frequency in Google Calendar, so frequent collaborators are easy to find when composing emails.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'automation'],
      alsoIntegrations: ['google_calendar'],
    },
    {
      icon: GoogleContactsIcon,
      title: 'Google Contacts birthday reminder',
      prompt:
        'Build a scheduled workflow that runs daily, surfaces upcoming birthdays from Google Contacts, and emails the user a reminder with personalized message suggestions.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'communication'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: GoogleContactsIcon,
      title: 'Google Contacts deal-mapper',
      prompt:
        'Create a workflow that maps Google Contacts to active Salesforce opportunities by email domain, tagging contacts as deal-relevant for fast follow-ups.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: GoogleContactsIcon,
      title: 'Google Contacts new-hire onboarder',
      prompt:
        'Build a workflow that on a new hire in Workday adds the new employee to relevant Google Contacts groups based on department and team.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation'],
      alsoIntegrations: ['workday'],
    },
  ],
  skills: [
    {
      name: 'add-contact',
      description: 'Create a new Google Contact with name, email, phone, and organization details.',
      content:
        '# Add a Contact\n\nCreate a new entry in Google Contacts.\n\n## Steps\n1. Gather the contact fields from the request: first name (required), last name, email, phone, organization, job title, and notes.\n2. Before creating, run Search Contacts on the email or full name to avoid duplicates.\n3. If no match exists, run Create Contact with the gathered fields and the appropriate email/phone types (work, home, mobile).\n4. Capture the new resource name from the response.\n\n## Output\nConfirm the created contact with name, email, organization, and the resource name. If a likely duplicate was found, surface it and ask before creating.',
    },
    {
      name: 'find-contact',
      description:
        'Search Google Contacts by name, email, phone, or organization and return matches.',
      content:
        '# Find a Contact\n\nLook up someone in Google Contacts.\n\n## Steps\n1. Build a query from whatever identifier you have (name, email, phone, or organization).\n2. Run Search Contacts with that query and a sensible Page Size.\n3. If you need full details for one match, take its resource name and run Get Contact.\n\n## Output\nA list of matching contacts with name, email, phone, organization, and resource name. If exactly one matches, return its full record; if several match, list them so the requester can disambiguate.',
    },
    {
      name: 'update-contact-details',
      description:
        'Update fields on an existing Google Contact such as email, phone, or job title.',
      content:
        '# Update Contact Details\n\nModify an existing Google Contact safely.\n\n## Steps\n1. If you do not have the resource name, run Search Contacts to find it.\n2. Run Get Contact to read the current values and capture the ETag (required for updates).\n3. Run Update Contact with the resource name, the ETag, and the changed fields only.\n4. If the update fails on a stale ETag, re-run Get Contact and retry with the fresh ETag.\n\n## Output\nConfirm which fields changed (old vs new) and return the updated record. Never update without first fetching the current ETag.',
    },
  ],
} as const satisfies BlockMeta
