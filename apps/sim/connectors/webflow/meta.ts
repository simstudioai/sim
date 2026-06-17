import { WebflowIcon } from '@/components/icons'
import type { ConnectorMeta } from '@/connectors/types'

export const webflowConnectorMeta: ConnectorMeta = {
  id: 'webflow',
  name: 'Webflow',
  description:
    'Sync CMS collection items from a Webflow site. Note: Webflow OAuth tokens do not support refresh — you may need to reconnect periodically.',
  version: '1.0.0',
  icon: WebflowIcon,

  auth: { mode: 'oauth', provider: 'webflow', requiredScopes: ['sites:read', 'cms:read'] },

  configFields: [
    {
      id: 'siteSelector',
      title: 'Site',
      type: 'selector',
      selectorKey: 'webflow.sites',
      canonicalParamId: 'siteId',
      mode: 'basic',
      placeholder: 'Select a site',
      required: true,
    },
    {
      id: 'siteId',
      title: 'Site ID',
      type: 'short-input',
      canonicalParamId: 'siteId',
      mode: 'advanced',
      placeholder: 'Your Webflow site ID',
      required: true,
    },
    {
      id: 'collectionSelector',
      title: 'Collections',
      type: 'selector',
      selectorKey: 'webflow.collections',
      canonicalParamId: 'collectionId',
      mode: 'basic',
      multi: true,
      dependsOn: ['siteSelector'],
      placeholder: 'Select collections (default: all collections)',
      required: false,
    },
    {
      id: 'collectionId',
      title: 'Collection IDs',
      type: 'short-input',
      canonicalParamId: 'collectionId',
      mode: 'advanced',
      multi: true,
      placeholder: 'Specific collection IDs, comma-separated (default: all collections)',
      required: false,
    },
    {
      id: 'maxItems',
      title: 'Max Items',
      type: 'short-input',
      placeholder: 'e.g. 500 (default: unlimited)',
      required: false,
    },
  ],

  tagDefinitions: [
    { id: 'collectionName', displayName: 'Collection Name', fieldType: 'text' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
    { id: 'slug', displayName: 'Slug', fieldType: 'text' },
  ],
}
