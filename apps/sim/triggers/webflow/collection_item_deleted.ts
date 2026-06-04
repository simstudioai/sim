import { createLogger } from '@sim/logger'
import { WebflowIcon } from '@/components/icons'
import { requestJson } from '@/lib/api/client/request'
import {
  webflowCollectionsSelectorContract,
  webflowSitesSelectorContract,
} from '@/lib/api/contracts/selectors/webflow'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
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
      placeholder: 'Select a site',
      description: 'The Webflow site to monitor',
      required: true,
      options: [],
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'webflow_collection_item_deleted',
      },
      fetchOptions: async (blockId: string) => {
        const credentialId = useSubBlockStore.getState().getValue(blockId, 'triggerCredentials') as
          | string
          | null
        if (!credentialId) {
          throw new Error('No Webflow credential selected')
        }
        try {
          const data = await requestJson(webflowSitesSelectorContract, {
            body: { credential: credentialId },
          })
          return (data.sites ?? []).map((site) => ({
            id: site.id,
            label: site.name,
          }))
        } catch (error) {
          logger.error('Error fetching Webflow sites:', error)
          throw error
        }
      },
      fetchOptionById: async (blockId: string, optionId: string) => {
        const credentialId = useSubBlockStore.getState().getValue(blockId, 'triggerCredentials') as
          | string
          | null
        if (!credentialId) return null
        try {
          const data = await requestJson(webflowSitesSelectorContract, {
            body: { credential: credentialId, siteId: optionId },
          })
          const site = data.sites?.find((s) => s.id === optionId)
          if (site) {
            return { id: site.id, label: site.name }
          }
          return null
        } catch {
          return null
        }
      },
      dependsOn: ['triggerCredentials'],
    },
    {
      id: 'triggerCollectionId',
      title: 'Collection',
      type: 'dropdown',
      placeholder: 'Select a collection (optional)',
      description: 'Optionally filter to monitor only a specific collection',
      required: false,
      options: [],
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'webflow_collection_item_deleted',
      },
      fetchOptions: async (blockId: string) => {
        const credentialId = useSubBlockStore.getState().getValue(blockId, 'triggerCredentials') as
          | string
          | null
        const siteId = useSubBlockStore.getState().getValue(blockId, 'triggerSiteId') as
          | string
          | null
        if (!credentialId || !siteId) {
          return []
        }
        try {
          const data = await requestJson(webflowCollectionsSelectorContract, {
            body: { credential: credentialId, siteId },
          })
          return (data.collections ?? []).map((collection) => ({
            id: collection.id,
            label: collection.name,
          }))
        } catch (error) {
          logger.error('Error fetching Webflow collections:', error)
          throw error
        }
      },
      fetchOptionById: async (blockId: string, optionId: string) => {
        const credentialId = useSubBlockStore.getState().getValue(blockId, 'triggerCredentials') as
          | string
          | null
        const siteId = useSubBlockStore.getState().getValue(blockId, 'triggerSiteId') as
          | string
          | null
        if (!credentialId || !siteId) return null
        try {
          const data = await requestJson(webflowCollectionsSelectorContract, {
            body: { credential: credentialId, siteId },
          })
          const collection = data.collections?.find((c) => c.id === optionId)
          if (collection) {
            return { id: collection.id, label: collection.name }
          }
          return null
        } catch {
          return null
        }
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
