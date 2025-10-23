import { WebflowIcon } from '@/components/icons'
import type { TriggerConfig } from '../types'

export const webflowCollectionItemDeletedTrigger: TriggerConfig = {
  id: 'webflow_collection_item_deleted',
  name: 'Collection Item Deleted',
  provider: 'webflow',
  description:
    'Trigger workflow when an item is deleted from a Webflow CMS collection (requires Webflow credentials)',
  version: '1.0.0',
  icon: WebflowIcon,

  requiresCredentials: true,
  credentialProvider: 'webflow',

  configFields: {
    siteId: {
      type: 'select',
      label: 'Site',
      placeholder: 'Select a site',
      description: 'The Webflow site to monitor',
      required: true,
      options: [],
    },
    collectionId: {
      type: 'select',
      label: 'Collection',
      placeholder: 'Select a collection (optional)',
      description: 'Optionally filter to monitor only a specific collection',
      required: false,
      options: [],
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
      description: 'The collection ID where the item was deleted',
    },
    payload: {
      id: { type: 'string', description: 'The ID of the deleted item' },
      deletedOn: { type: 'string', description: 'Timestamp when the item was deleted' },
    },
  },

  instructions: [
    'Connect your Webflow account using the "Select Webflow credential" button above.',
    'Enter your Webflow Site ID (found in the site URL or site settings).',
    'Optionally enter a Collection ID to monitor only specific collections.',
    'If no Collection ID is provided, the trigger will fire for items deleted in any collection on the site.',
    'The webhook will trigger whenever an item is deleted from the specified collection(s).',
    'Note: Once an item is deleted, only minimal information (ID, collection, site) is available.',
    'Make sure your Webflow account has appropriate permissions for the specified site.',
  ],

  samplePayload: {
    siteId: '68f9666057aa8abaa9b0b668',
    workspaceId: '68f96081e7018465432953b5',
    collectionId: '68f9666257aa8abaa9b0b6d6',
    payload: {
      id: '68fa8445de250e147cd95cfd',
      deletedOn: '2024-01-15T16:20:00.000Z',
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
