import { SalesforceIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const salesforceConnectorMeta: ConnectorMeta = {
  id: 'salesforce',
  name: 'Salesforce',
  description: 'Sync records from Salesforce',
  version: '1.0.0',
  icon: SalesforceIcon,

  /**
   * `openid` is listed alongside `api` because the connector resolves the org's
   * instance URL from `/services/oauth2/userinfo`, Salesforce's OpenID Connect
   * UserInfo endpoint. Salesforce does not document a required scope for it, so
   * this mirrors the scope set the `salesforce` OAuth provider already requests
   * rather than asserting a contract the docs do not state.
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
        'Knowledge Articles only. Article queries are pinned to one language, so only articles in this language are synced.',
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
