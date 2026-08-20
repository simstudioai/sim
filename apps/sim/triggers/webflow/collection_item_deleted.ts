import { createLogger } from '@sim/logger'
import { WebflowIcon } from '@/components/icons'
import type { TriggerConfig } from '../types'

const logger = createLogger('webflow-collection-item-deleted-trigger')

export const webflowCollectionItemDeletedTrigger: TriggerConfig = {
  id: 'webflow_collection_item_deleted',
  name: 'Collection Item Deleted',
  provider: 'webflow',
  description:
    'Trigger workflow when an item is deleted from a Webflow CMS collection (requires Webflow credentials)',
  version: '1.0.0',
  icon: WebflowIcon,

  subBlocks: [
    {
      id: 'triggerCredentials',
      title: 'Credentials',
      type: 'oauth-input',
      canonicalParamId: 'oauthCredential',
      description: 'This trigger requires webflow credentials to access your account.',
      serviceId: 'webflow',
      requiredScopes: [],
      required: true,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'webflow_collection_item_deleted',
      },
    },
    {
      id: 'triggerSiteId',
      title: 'Site',
      type: 'dropdown',
      canonicalParamId: 'siteId',
      selectorKey: 'webflow.sites',
      placeholder: 'Select a site',
      description: 'The Webflow site to monitor',
      required: true,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'webflow_collection_item_deleted',
      },
      dependsOn: ['triggerCredentials'],
    },
    {
      id: 'triggerCollectionId',
      title: 'Collection',
      type: 'dropdown',
      canonicalParamId: 'collectionId',
      selectorKey: 'webflow.collections',
      placeholder: 'Select a collection (optional)',
      description: 'Optionally filter to monitor only a specific collection',
      required: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'webflow_collection_item_deleted',
      },
      dependsOn: ['triggerCredentials', 'triggerSiteId'],
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        'Connect your Webflow account using the "Select Webflow credential" button above.',
        'Select your Webflow site from the dropdown.',
        'Optionally select a collection to monitor only specific collections.',
        'If no collection is selected, the trigger will fire for items deleted in any collection on the site.',
        'The webhook will trigger whenever an item is deleted from the specified collection(s).',
        'Note: Once an item is deleted, only minimal information (ID, collection, site) is available.',
        'Make sure your Webflow account has appropriate permissions for the specified site.',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'webflow_collection_item_deleted',
      },
    },
  ],

  outputs: {
    siteId: {
      type: 'string',
      description: 'The site ID where the event occurred',
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

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
