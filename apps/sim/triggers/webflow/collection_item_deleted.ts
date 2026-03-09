import { createLogger } from '@sim/logger'
import { WebflowIcon } from '@/components/icons'
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
      fetchOptions: async (blockId: string, _subBlockId: string) => {
        const credentialId = useSubBlockStore.getState().getValue(blockId, 'triggerCredentials') as
          | string
          | null
        if (!credentialId) {
          throw new Error('No Webflow credential selected')
        }
        try {
          const response = await fetch('/api/tools/webflow/sites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential: credentialId }),
          })
          if (!response.ok) {
            throw new Error('Failed to fetch Webflow sites')
          }
          const data = await response.json()
          if (data.sites && Array.isArray(data.sites)) {
            return data.sites.map((site: { id: string; name: string }) => ({
              id: site.id,
              label: site.name,
            }))
          }
          return []
        } catch (error) {
          logger.error('Error fetching Webflow sites:', error)
          throw error
        }
      },
      fetchOptionById: async (blockId: string, _subBlockId: string, optionId: string) => {
        const credentialId = useSubBlockStore.getState().getValue(blockId, 'triggerCredentials') as
          | string
          | null
        if (!credentialId) return null
        try {
          const response = await fetch('/api/tools/webflow/sites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential: credentialId, siteId: optionId }),
          })
          if (!response.ok) return null
          const data = await response.json()
          const site = data.sites?.find((s: { id: string }) => s.id === optionId)
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
      fetchOptions: async (blockId: string, _subBlockId: string) => {
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
          const response = await fetch('/api/tools/webflow/collections', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential: credentialId, siteId }),
          })
          if (!response.ok) {
            throw new Error('Failed to fetch Webflow collections')
          }
          const data = await response.json()
          if (data.collections && Array.isArray(data.collections)) {
            return data.collections.map((collection: { id: string; name: string }) => ({
              id: collection.id,
              label: collection.name,
            }))
          }
          return []
        } catch (error) {
          logger.error('Error fetching Webflow collections:', error)
          throw error
        }
      },
      fetchOptionById: async (blockId: string, _subBlockId: string, optionId: string) => {
        const credentialId = useSubBlockStore.getState().getValue(blockId, 'triggerCredentials') as
          | string
          | null
        const siteId = useSubBlockStore.getState().getValue(blockId, 'triggerSiteId') as
          | string
          | null
        if (!credentialId || !siteId) return null
        try {
          const response = await fetch('/api/tools/webflow/collections', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential: credentialId, siteId }),
          })
          if (!response.ok) return null
          const data = await response.json()
          const collection = data.collections?.find((c: { id: string }) => c.id === optionId)
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
      id: 'triggerSave',
      title: '',
      type: 'trigger-save',
      hideFromPreview: true,
      mode: 'trigger',
      triggerId: 'webflow_collection_item_deleted',
      condition: {
        field: 'selectedTriggerId',
        value: 'webflow_collection_item_deleted',
      },
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
