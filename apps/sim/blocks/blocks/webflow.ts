import { WebflowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { WebflowResponse } from '@/tools/webflow/types'
import { getTrigger } from '@/triggers'

export const WebflowBlock: BlockConfig<WebflowResponse> = {
  type: 'webflow',
  name: 'Webflow',
  description: 'Manage Webflow CMS collections',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrates Webflow CMS into the workflow. Can create, get, list, update, or delete items in Webflow CMS collections. Manage your Webflow content programmatically. Can be used in trigger mode to trigger workflows when collection items change or forms are submitted.',
  docsLink: 'https://docs.sim.ai/tools/webflow',
  category: 'tools',
  triggerAllowed: true,
  bgColor: '#E0E0E0',
  icon: WebflowIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Items', id: 'list' },
        { label: 'Get Item', id: 'get' },
        { label: 'Create Item', id: 'create' },
        { label: 'Update Item', id: 'update' },
        { label: 'Delete Item', id: 'delete' },
      ],
      value: () => 'list',
    },
    {
      id: 'credential',
      title: 'Webflow Account',
      type: 'oauth-input',
      provider: 'webflow',
      serviceId: 'webflow',
      requiredScopes: ['sites:read', 'sites:write', 'cms:read', 'cms:write'],
      placeholder: 'Select Webflow account',
      required: true,
    },
    {
      id: 'collectionId',
      title: 'Collection ID',
      type: 'short-input',
      placeholder: 'Enter collection ID',
      dependsOn: ['credential'],
      required: true,
    },
    {
      id: 'itemId',
      title: 'Item ID',
      type: 'short-input',
      placeholder: 'ID of the item',
      condition: { field: 'operation', value: ['get', 'update', 'delete'] },
      required: true,
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: 'Pagination offset (optional)',
      condition: { field: 'operation', value: 'list' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Max items to return (optional)',
      condition: { field: 'operation', value: 'list' },
    },
    {
      id: 'fieldData',
      title: 'Field Data',
      type: 'code',
      language: 'json',
      placeholder: 'Field data as JSON: `{ "name": "Item Name", "slug": "item-slug" }`',
      condition: { field: 'operation', value: ['create', 'update'] },
      required: true,
    },
    ...getTrigger('webflow_collection_item_created').subBlocks,
    ...getTrigger('webflow_collection_item_changed').subBlocks,
    ...getTrigger('webflow_collection_item_deleted').subBlocks,
  ],
  tools: {
    access: [
      'webflow_list_items',
      'webflow_get_item',
      'webflow_create_item',
      'webflow_update_item',
      'webflow_delete_item',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'list':
            return 'webflow_list_items'
          case 'get':
            return 'webflow_get_item'
          case 'create':
            return 'webflow_create_item'
          case 'update':
            return 'webflow_update_item'
          case 'delete':
            return 'webflow_delete_item'
          default:
            throw new Error(`Invalid Webflow operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { credential, fieldData, ...rest } = params
        let parsedFieldData: any | undefined

        try {
          if (fieldData && (params.operation === 'create' || params.operation === 'update')) {
            parsedFieldData = JSON.parse(fieldData)
          }
        } catch (error: any) {
          throw new Error(`Invalid JSON input for ${params.operation} operation: ${error.message}`)
        }

        const baseParams = {
          credential,
          ...rest,
        }

        switch (params.operation) {
          case 'create':
          case 'update':
            return { ...baseParams, fieldData: parsedFieldData }
          default:
            return baseParams
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Webflow OAuth access token' },
    collectionId: { type: 'string', description: 'Webflow collection identifier' },
    // Conditional inputs
    itemId: { type: 'string', description: 'Item identifier' }, // Required for get/update/delete
    offset: { type: 'number', description: 'Pagination offset' }, // Optional for list
    limit: { type: 'number', description: 'Maximum items to return' }, // Optional for list
    fieldData: { type: 'json', description: 'Item field data' }, // Required for create/update
  },
  outputs: {
    items: { type: 'json', description: 'Array of items (list operation)' },
    item: { type: 'json', description: 'Single item data (get/create/update operations)' },
    success: { type: 'boolean', description: 'Operation success status (delete operation)' },
    metadata: { type: 'json', description: 'Operation metadata' },
    // Trigger outputs
    siteId: { type: 'string', description: 'Site ID where event occurred' },
    workspaceId: { type: 'string', description: 'Workspace ID where event occurred' },
    collectionId: { type: 'string', description: 'Collection ID (for collection events)' },
    payload: { type: 'json', description: 'Event payload data (item data for collection events)' },
    name: { type: 'string', description: 'Form name (for form submissions)' },
    id: { type: 'string', description: 'Submission ID (for form submissions)' },
    submittedAt: { type: 'string', description: 'Submission timestamp (for form submissions)' },
    data: { type: 'json', description: 'Form field data (for form submissions)' },
    schema: { type: 'json', description: 'Form schema (for form submissions)' },
    formElementId: { type: 'string', description: 'Form element ID (for form submissions)' },
  },
  triggers: {
    enabled: true,
    available: [
      'webflow_collection_item_created',
      'webflow_collection_item_changed',
      'webflow_collection_item_deleted',
      'webflow_form_submission',
    ],
  },
}
