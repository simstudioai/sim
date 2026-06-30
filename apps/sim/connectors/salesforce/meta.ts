import { SalesforceIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const salesforceConnectorMeta: ConnectorMeta = {
  id: 'salesforce',
  name: 'Salesforce',
  description: 'Sync records from Salesforce',
  version: '1.0.0',
  icon: SalesforceIcon,

  auth: { mode: 'oauth', provider: 'salesforce', requiredScopes: ['api', 'refresh_token'] },

  configFields: [
    {
      id: 'objectType',
      title: 'Object Type',
      type: 'dropdown',
      required: true,
      options: [
        { label: 'Knowledge Articles', id: 'KnowledgeArticleVersion' },
        { label: 'Cases', id: 'Case' },
        { label: 'Accounts', id: 'Account' },
        { label: 'Opportunities', id: 'Opportunity' },
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
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
    { id: 'recordNumber', displayName: 'Record Number', fieldType: 'text' },
    { id: 'status', displayName: 'Status', fieldType: 'text' },
  ],
}
