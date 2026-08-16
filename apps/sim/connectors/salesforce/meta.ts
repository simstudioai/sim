import { SalesforceIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const salesforceConnectorMeta: ConnectorMeta = {
  id: 'salesforce',
  name: 'Salesforce',
  description: 'Sync records from Salesforce',
  version: '1.0.0',
  icon: SalesforceIcon,

  /**
   * `openid` is required as well as `api`: the connector resolves the org's
   * instance URL from `/services/oauth2/userinfo`, which a connected app can
   * only call when the unique-identifier (openid) scope was granted.
   */
  auth: {
    mode: 'oauth',
    provider: 'salesforce',
    requiredScopes: ['api', 'refresh_token', 'openid'],
  },

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
      id: 'articleLanguage',
      title: 'Article Language',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. en_US (default: en_US)',
      description:
        'Knowledge Articles only. Salesforce requires article queries to filter on a single language, so only articles in this language are synced.',
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
