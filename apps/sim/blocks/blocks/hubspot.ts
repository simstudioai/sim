import { HubspotIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { HubSpotResponse } from '@/tools/hubspot/types'

export const HubSpotBlock: BlockConfig<HubSpotResponse> = {
  type: 'hubspot',
  name: 'HubSpot',
  description: 'Interact with HubSpot CRM',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate HubSpot into your workflow. Manage contacts, companies, deals, tickets, and other CRM objects with powerful automation capabilities.',
  docsLink: 'https://docs.sim.ai/tools/hubspot',
  category: 'tools',
  bgColor: '#FF7A59',
  icon: HubspotIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Get Users', id: 'get_users' },
        { label: 'Get Contacts', id: 'get_contacts' },
        { label: 'Create Contact', id: 'create_contact' },
        { label: 'Update Contact', id: 'update_contact' },
        { label: 'Search Contacts', id: 'search_contacts' },
        { label: 'Get Companies', id: 'get_companies' },
        { label: 'Create Company', id: 'create_company' },
        { label: 'Update Company', id: 'update_company' },
        { label: 'Search Companies', id: 'search_companies' },
        { label: 'Get Deals', id: 'get_deals' },
      ],
      value: () => 'get_contacts',
    },
    {
      id: 'credential',
      title: 'HubSpot Account',
      type: 'oauth-input',
      layout: 'full',
      provider: 'hubspot',
      serviceId: 'hubspot',
      requiredScopes: [
        'crm.objects.contacts.read',
        'crm.objects.contacts.write',
        'crm.objects.companies.read',
        'crm.objects.companies.write',
        'crm.objects.deals.read',
        'crm.objects.deals.write',
        'crm.objects.owners.read',
        'crm.objects.users.read',
        'crm.objects.users.write',
        'crm.objects.marketing_events.read',
        'crm.objects.marketing_events.write',
        'crm.objects.line_items.read',
        'crm.objects.line_items.write',
        'crm.objects.quotes.read',
        'crm.objects.quotes.write',
        'crm.objects.appointments.read',
        'crm.objects.appointments.write',
        'crm.objects.carts.read',
        'crm.objects.carts.write',
        'crm.import',
        'crm.lists.read',
        'crm.lists.write',
        'tickets',
      ],
      placeholder: 'Select HubSpot account',
      required: true,
    },
    {
      id: 'contactId',
      title: 'Contact ID or Email',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Optional - Leave empty to list all contacts',
      condition: { field: 'operation', value: ['get_contacts', 'update_contact'] },
    },
    {
      id: 'companyId',
      title: 'Company ID or Domain',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Optional - Leave empty to list all companies',
      condition: { field: 'operation', value: ['get_companies', 'update_company'] },
    },
    {
      id: 'idProperty',
      title: 'ID Property',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Optional - e.g., "email" for contacts, "domain" for companies',
      condition: {
        field: 'operation',
        value: ['get_contacts', 'update_contact', 'get_companies', 'update_company'],
      },
    },
    {
      id: 'propertiesToSet',
      title: 'Properties',
      type: 'long-input',
      layout: 'full',
      placeholder:
        'JSON object with properties (e.g., {"email": "test@example.com", "firstname": "John"})',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact', 'create_company', 'update_company'],
      },
    },
    {
      id: 'properties',
      title: 'Properties to Return',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Comma-separated list (e.g., "email,firstname,lastname")',
      condition: { field: 'operation', value: ['get_contacts', 'get_companies', 'get_deals'] },
    },
    {
      id: 'associations',
      title: 'Associations',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Comma-separated object types (e.g., "companies,deals")',
      condition: {
        field: 'operation',
        value: ['get_contacts', 'get_companies', 'get_deals', 'create_contact', 'create_company'],
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Max results (list: 100, search: 200)',
      condition: {
        field: 'operation',
        value: [
          'get_users',
          'get_contacts',
          'get_companies',
          'get_deals',
          'search_contacts',
          'search_companies',
        ],
      },
    },
    {
      id: 'after',
      title: 'After (Pagination)',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Pagination cursor from previous response',
      condition: {
        field: 'operation',
        value: [
          'get_contacts',
          'get_companies',
          'get_deals',
          'search_contacts',
          'search_companies',
        ],
      },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Search term (e.g., company name, contact email)',
      condition: { field: 'operation', value: ['search_contacts', 'search_companies'] },
    },
    {
      id: 'filterGroups',
      title: 'Filter Groups',
      type: 'long-input',
      layout: 'full',
      placeholder:
        'JSON array of filter groups (e.g., [{"filters":[{"propertyName":"email","operator":"EQ","value":"test@example.com"}]}])',
      condition: { field: 'operation', value: ['search_contacts', 'search_companies'] },
    },
    {
      id: 'sorts',
      title: 'Sort Order',
      type: 'long-input',
      layout: 'full',
      placeholder:
        'JSON array of sort objects (e.g., [{"propertyName":"createdate","direction":"DESCENDING"}])',
      condition: { field: 'operation', value: ['search_contacts', 'search_companies'] },
    },
    {
      id: 'searchProperties',
      title: 'Properties to Return',
      type: 'long-input',
      layout: 'full',
      placeholder: 'JSON array of properties (e.g., ["email","firstname","lastname"])',
      condition: { field: 'operation', value: ['search_contacts', 'search_companies'] },
    },
  ],
  tools: {
    access: [
      'hubspot_get_users',
      'hubspot_list_contacts',
      'hubspot_get_contact',
      'hubspot_create_contact',
      'hubspot_update_contact',
      'hubspot_search_contacts',
      'hubspot_list_companies',
      'hubspot_get_company',
      'hubspot_create_company',
      'hubspot_update_company',
      'hubspot_search_companies',
      'hubspot_list_deals',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'get_users':
            return 'hubspot_get_users'
          case 'get_contacts':
            return params.contactId ? 'hubspot_get_contact' : 'hubspot_list_contacts'
          case 'create_contact':
            return 'hubspot_create_contact'
          case 'update_contact':
            return 'hubspot_update_contact'
          case 'search_contacts':
            return 'hubspot_search_contacts'
          case 'get_companies':
            return params.companyId ? 'hubspot_get_company' : 'hubspot_list_companies'
          case 'create_company':
            return 'hubspot_create_company'
          case 'update_company':
            return 'hubspot_update_company'
          case 'search_companies':
            return 'hubspot_search_companies'
          case 'get_deals':
            return 'hubspot_list_deals'
          default:
            throw new Error(`Unknown operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          credential,
          operation,
          propertiesToSet,
          properties,
          searchProperties,
          filterGroups,
          sorts,
          associations,
          ...rest
        } = params

        const cleanParams: Record<string, any> = {
          credential,
        }

        if (propertiesToSet) {
          try {
            cleanParams.properties =
              typeof propertiesToSet === 'string' ? JSON.parse(propertiesToSet) : propertiesToSet
          } catch (error) {
            throw new Error('Invalid JSON in properties field')
          }
        }

        if (properties && !searchProperties) {
          cleanParams.properties = properties
        }

        if (searchProperties) {
          try {
            cleanParams.properties =
              typeof searchProperties === 'string' ? JSON.parse(searchProperties) : searchProperties
          } catch (error) {
            throw new Error('Invalid JSON in searchProperties field')
          }
        }

        if (filterGroups) {
          try {
            cleanParams.filterGroups =
              typeof filterGroups === 'string' ? JSON.parse(filterGroups) : filterGroups
          } catch (error) {
            throw new Error('Invalid JSON in filterGroups field')
          }
        }

        if (sorts) {
          try {
            cleanParams.sorts = typeof sorts === 'string' ? JSON.parse(sorts) : sorts
          } catch (error) {
            throw new Error('Invalid JSON in sorts field')
          }
        }

        if (associations) {
          cleanParams.associations = associations
        }

        // Add other params
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
    credential: { type: 'string', description: 'HubSpot access token' },
    contactId: { type: 'string', description: 'Contact ID or email' },
    companyId: { type: 'string', description: 'Company ID or domain' },
    idProperty: { type: 'string', description: 'Property name to use as unique identifier' },
    propertiesToSet: { type: 'json', description: 'Properties to create/update (JSON object)' },
    properties: {
      type: 'string',
      description: 'Comma-separated properties to return (for list/get)',
    },
    associations: { type: 'string', description: 'Comma-separated object types for associations' },
    limit: { type: 'string', description: 'Maximum results (list: 100, search: 200)' },
    after: { type: 'string', description: 'Pagination cursor' },
    query: { type: 'string', description: 'Search query string' },
    filterGroups: { type: 'json', description: 'Filter groups for search (JSON array)' },
    sorts: { type: 'json', description: 'Sort order (JSON array of strings or objects)' },
    searchProperties: { type: 'json', description: 'Properties to return in search (JSON array)' },
  },
  outputs: {
    users: { type: 'json', description: 'Array of user objects' },
    contacts: { type: 'json', description: 'Array of contact objects' },
    contact: { type: 'json', description: 'Single contact object' },
    companies: { type: 'json', description: 'Array of company objects' },
    company: { type: 'json', description: 'Single company object' },
    deals: { type: 'json', description: 'Array of deal objects' },
    total: { type: 'number', description: 'Total number of matching results (for search)' },
    paging: { type: 'json', description: 'Pagination info with next/prev cursors' },
    metadata: { type: 'json', description: 'Operation metadata' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
