// /sim/blocks/hubspotBlock.ts
import { HubspotIcon } from '@/components/icons'
import { BlockConfig } from '../types'
import {
  ListContactsResponse,
  CreateContactResponse,
  UpdateContactResponse,
  SearchContactsResponse,
  ListDealsResponse,
  CreateDealResponse,
  UpdateDealResponse,
  SearchDealsResponse,
  ListCampaignsResponse,
  ListFormsResponse,
  ListEmailsResponse
} from '@/tools/hubspot/types'

type HubspotResponse =
  | ListContactsResponse
  | CreateContactResponse
  | UpdateContactResponse
  | SearchContactsResponse
  | ListDealsResponse
  | CreateDealResponse
  | UpdateDealResponse
  | SearchDealsResponse
  | ListCampaignsResponse
  | ListFormsResponse
  | ListEmailsResponse

export const HubspotBlock: BlockConfig<HubspotResponse> = {
  type: 'hubspot',
  name: 'HubSpot',
  description: 'CRM and marketing automation.',
  longDescription:
    'Authenticate via OAuth to manage contacts, deals, campaigns, forms, and emails directly in your workflows.',
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
        { label: 'List Contacts', id: 'list_contacts' },
        { label: 'Create Contact', id: 'create_contact' },
        { label: 'Update Contact', id: 'update_contact' },
        { label: 'Search Contacts', id: 'search_contacts' },
        { label: 'List Deals', id: 'list_deals' },
        { label: 'Create Deal', id: 'create_deal' },
        { label: 'Update Deal', id: 'update_deal' },
        { label: 'Search Deals', id: 'search_deals' },
        { label: 'List Campaigns', id: 'list_campaigns' },
        { label: 'List Forms', id: 'list_forms' },
        { label: 'List Emails', id: 'list_emails' },
      ],
      value: () => 'list_contacts',
    },
    {
      id: 'credential',
      title: 'HubSpot Account',
      type: 'oauth-input',
      layout: 'full',
      provider: 'hubspot',
      serviceId: 'hubspot',
      requiredScopes: [
        'oauth',
        'crm.objects.contacts.read',
        'crm.objects.contacts.write',
        'crm.objects.deals.read',
        'crm.objects.deals.write',
        'marketing.campaigns.read',
        'forms',
      ],
      placeholder: 'Select HubSpot account',
    },
    // -- CONTACTS --
    {
      id: 'limit',
      title: 'Page Size / Limit',
      type: 'short-input',
      layout: 'half',
      placeholder: '100',
      condition: {
        field: 'operation',
        value: ['list_contacts', 'list_deals']
      }
    },
    {
      id: 'contactId',
      title: 'Contact ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'e.g. 12345',
      condition: {
        field: 'operation',
        value: ['update_contact']
      }
    },
    {
      id: 'contactProperties',
      title: 'Contact Properties (JSON)',
      type: 'long-input',
      layout: 'full',
      placeholder: '{"email":"test@example.com","firstname":"Jane"}',
      condition: {
        field: 'operation',
        value: ['create_contact', 'update_contact']
      }
    },
    {
      id: 'contactSearchFilter',
      title: 'Contact Search Filter (JSON)',
      type: 'long-input',
      layout: 'full',
      placeholder: '{"filterGroups":[{"filters":[{"propertyName":"email","operator":"EQ","value":"test@example.com"}]}]}',
      condition: {
        field: 'operation',
        value: ['search_contacts']
      }
    },

    // -- DEALS --
    {
      id: 'dealId',
      title: 'Deal ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'e.g. 67890',
      condition: {
        field: 'operation',
        value: ['update_deal']
      }
    },
    {
      id: 'dealProperties',
      title: 'Deal Properties (JSON)',
      type: 'long-input',
      layout: 'full',
      placeholder: '{"dealname":"Big Deal","amount":50000}',
      condition: {
        field: 'operation',
        value: ['create_deal', 'update_deal']
      }
    },
    {
      id: 'dealSearchFilter',
      title: 'Deal Search Filter (JSON)',
      type: 'long-input',
      layout: 'full',
      placeholder: '{"filterGroups":[{"filters":[{"propertyName":"dealname","operator":"CONTAINS_TOKEN","value":"Big"}]}]}',
      condition: {
        field: 'operation',
        value: ['search_deals']
      }
    },

    // -- MARKETING --
    {
      id: 'campaignLimit',
      title: 'Campaign Page Size',
      type: 'short-input',
      layout: 'full',
      placeholder: '100',
      condition: { field: 'operation', value: 'list_campaigns' }
    },
    {
      id: 'formLimit',
      title: 'Form Page Size',
      type: 'short-input',
      layout: 'full',
      placeholder: '100',
      condition: { field: 'operation', value: 'list_forms' }
    },
    {
      id: 'emailLimit',
      title: 'Email Page Size',
      type: 'short-input',
      layout: 'full',
      placeholder: '100',
      condition: { field: 'operation', value: 'list_emails' }
    },
  ],

  tools: {
    access: [
      'hubspot_list_contacts',
      'hubspot_create_contact',
      'hubspot_update_contact',
      'hubspot_search_contacts',
      'hubspot_list_deals',
      'hubspot_create_deal',
      'hubspot_update_deal',
      'hubspot_search_deals',
      'hubspot_list_campaigns',
      'hubspot_list_forms',
      'hubspot_list_emails'
    ],
    config: {
      tool: params => {
        switch (params.operation) {
          case 'list_contacts': return 'hubspot_list_contacts'
          case 'create_contact': return 'hubspot_create_contact'
          case 'update_contact': return 'hubspot_update_contact'
          case 'search_contacts': return 'hubspot_search_contacts'
          case 'list_deals': return 'hubspot_list_deals'
          case 'create_deal': return 'hubspot_create_deal'
          case 'update_deal': return 'hubspot_update_deal'
          case 'search_deals': return 'hubspot_search_deals'
          case 'list_campaigns': return 'hubspot_list_campaigns'
          case 'list_forms': return 'hubspot_list_forms'
          case 'list_emails': return 'hubspot_list_emails'
          default: throw new Error('Invalid operation')
        }
      },
      params: params => {
        const { credential: accessToken, operation, ...rest } = params
        // Parse JSON inputs into objects where needed
        const p: Record<string, any> = { accessToken }
        if (rest.limit) p.limit = parseInt(rest.limit as string, 10)
        if (rest.campaignLimit) p.limit = parseInt(rest.campaignLimit as string, 10)
        if (rest.formLimit) p.limit = parseInt(rest.formLimit as string, 10)
        if (rest.emailLimit) p.limit = parseInt(rest.emailLimit as string, 10)
        if (rest.contactProperties) p.properties = JSON.parse(rest.contactProperties as string)
        if (rest.dealProperties) p.properties = JSON.parse(rest.dealProperties as string)
        if (rest.contactSearchFilter) p.search = JSON.parse(rest.contactSearchFilter as string)
        if (rest.dealSearchFilter) p.search = JSON.parse(rest.dealSearchFilter as string)
        if (rest.contactId) p.contactId = rest.contactId
        if (rest.dealId) p.dealId = rest.dealId
        return p
      }
    }
  },

  inputs: {
    operation: { type: 'string', required: true },
    credential: { type: 'string', required: true },
    limit: { type: 'string', required: false },
    contactId: { type: 'string', required: false },
    contactProperties: { type: 'string', required: false },
    contactSearchFilter: { type: 'string', required: false },
    dealId: { type: 'string', required: false },
    dealProperties: { type: 'string', required: false },
    dealSearchFilter: { type: 'string', required: false },
    campaignLimit: { type: 'string', required: false },
    formLimit: { type: 'string', required: false },
    emailLimit: { type: 'string', required: false },
  },

  outputs: {
    response: {
      type: 'json',
    }
  }
}