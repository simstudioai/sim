import { HubspotIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const hubspotConnectorMeta: ConnectorMeta = {
  id: 'hubspot',
  name: 'HubSpot',
  description: 'Sync CRM records from HubSpot',
  version: '1.0.0',
  icon: HubspotIcon,

  auth: {
    mode: 'oauth',
    provider: 'hubspot',
    requiredScopes: [
      'crm.objects.contacts.read',
      'crm.objects.companies.read',
      'crm.objects.deals.read',
      'tickets',
    ],
  },

  configFields: [
    {
      id: 'objectType',
      title: 'Object Type',
      type: 'dropdown',
      required: true,
      options: [
        { label: 'Contacts', id: 'contacts' },
        { label: 'Companies', id: 'companies' },
        { label: 'Deals', id: 'deals' },
        { label: 'Tickets', id: 'tickets' },
      ],
    },
    {
      id: 'maxRecords',
      title: 'Max Records',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
    },
  ],

  tagDefinitions: [
    { id: 'objectType', displayName: 'Object Type', fieldType: 'text' },
    { id: 'owner', displayName: 'Owner', fieldType: 'text' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
    { id: 'pipeline', displayName: 'Pipeline', fieldType: 'text' },
  ],
}
