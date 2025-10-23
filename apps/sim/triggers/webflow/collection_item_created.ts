import { WebflowIcon } from '@/components/icons'
import type { TriggerConfig } from '../types'

export const webflowCollectionItemCreatedTrigger: TriggerConfig = {
  id: 'webflow_collection_item_created',
  name: 'Collection Item Created',
  provider: 'webflow',
  description:
    'Trigger workflow when a new item is created in a Webflow CMS collection (requires Webflow credentials)',
  version: '1.0.0',
  icon: WebflowIcon,

  // Webflow requires OAuth credentials to create webhooks
  requiresCredentials: true,
  credentialProvider: 'webflow',

  configFields: {
    siteId: {
      type: 'select',
      label: 'Site',
      placeholder: 'Select a site',
      description: 'The Webflow site to monitor',
      required: true,
      options: [], // Will be populated dynamically from API
    },
    collectionId: {
      type: 'select',
      label: 'Collection',
      placeholder: 'Select a collection (optional)',
      description: 'Optionally filter to monitor only a specific collection',
      required: false,
      options: [], // Will be populated dynamically based on selected site
    },
  },

  outputs: {
    siteId: {
      type: 'string',
      description: 'The site ID where the event occurred',
    },
    workspaceId: {
      type: 'string',
      description: 'The workspace ID where the event occurred',
    },
    collectionId: {
      type: 'string',
      description: 'The collection ID where the item was created',
    },
    payload: {
      id: { type: 'string', description: 'The ID of the created item' },
      cmsLocaleId: { type: 'string', description: 'CMS locale ID' },
      lastPublished: { type: 'string', description: 'Last published timestamp' },
      lastUpdated: { type: 'string', description: 'Last updated timestamp' },
      createdOn: { type: 'string', description: 'Timestamp when the item was created' },
      isArchived: { type: 'boolean', description: 'Whether the item is archived' },
      isDraft: { type: 'boolean', description: 'Whether the item is a draft' },
      fieldData: { type: 'object', description: 'The field data of the item' },
    },
  },

  instructions: [
    'Connect your Webflow account using the "Select Webflow credential" button above.',
    'Enter your Webflow Site ID (found in the site URL or site settings).',
    'Optionally enter a Collection ID to monitor only specific collections.',
    'If no Collection ID is provided, the trigger will fire for items created in any collection on the site.',
    'The webhook will trigger whenever a new item is created in the specified collection(s).',
    'Make sure your Webflow account has appropriate permissions for the specified site.',
  ],

  samplePayload: {
    siteId: '6c3592',
    workspaceId: 'abc123def456',
    collectionId: '68f9666257aa8abaa9b0b6d6',
    payload: {
      id: '68f9666257aa8abaa9b0b6d7',
      cmsLocaleId: '653ad57de882f528b32e810e',
      lastPublished: '2024-01-15T10:30:00.000Z',
      lastUpdated: '2024-01-15T10:30:00.000Z',
      createdOn: '2024-01-15T10:30:00.000Z',
      isArchived: false,
      isDraft: false,
      fieldData: {
        name: 'Sample Item',
        slug: 'sample-item',
        description: 'This is a sample item created in the collection',
      },
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
