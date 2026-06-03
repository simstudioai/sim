import { WebflowIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
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
  integrationType: IntegrationType.Marketing,
  triggerAllowed: true,
  bgColor: '#FFFFFF',
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
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      serviceId: 'webflow',
      requiredScopes: getScopesForService('webflow'),
      placeholder: 'Select Webflow account',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Webflow Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'siteSelector',
      title: 'Site',
      type: 'project-selector',
      canonicalParamId: 'siteId',
      serviceId: 'webflow',
      selectorKey: 'webflow.sites',
      placeholder: 'Select Webflow site',
      dependsOn: ['credential'],
      mode: 'basic',
      required: true,
    },
    {
      id: 'manualSiteId',
      title: 'Site ID',
      type: 'short-input',
      canonicalParamId: 'siteId',
      placeholder: 'Enter site ID',
      mode: 'advanced',
      required: true,
    },
    {
      id: 'collectionSelector',
      title: 'Collection',
      type: 'file-selector',
      canonicalParamId: 'collectionId',
      serviceId: 'webflow',
      selectorKey: 'webflow.collections',
      placeholder: 'Select collection',
      dependsOn: ['credential', 'siteSelector'],
      mode: 'basic',
      required: true,
    },
    {
      id: 'manualCollectionId',
      title: 'Collection ID',
      type: 'short-input',
      canonicalParamId: 'collectionId',
      placeholder: 'Enter collection ID',
      mode: 'advanced',
      required: true,
    },
    {
      id: 'itemSelector',
      title: 'Item',
      type: 'file-selector',
      canonicalParamId: 'itemId',
      serviceId: 'webflow',
      selectorKey: 'webflow.items',
      placeholder: 'Select item',
      dependsOn: ['credential', 'collectionSelector'],
      mode: 'basic',
      condition: { field: 'operation', value: ['get', 'update', 'delete'] },
      required: true,
    },
    {
      id: 'manualItemId',
      title: 'Item ID',
      type: 'short-input',
      canonicalParamId: 'itemId',
      placeholder: 'Enter item ID',
      mode: 'advanced',
      condition: { field: 'operation', value: ['get', 'update', 'delete'] },
      required: true,
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: 'Pagination offset (optional)',
      condition: { field: 'operation', value: 'list' },
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Max items to return (optional)',
      condition: { field: 'operation', value: 'list' },
      mode: 'advanced',
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
    ...getTrigger('webflow_form_submission').subBlocks,
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
        const {
          oauthCredential,
          fieldData,
          siteId, // Canonical param from siteSelector (basic) or manualSiteId (advanced)
          collectionId, // Canonical param from collectionSelector (basic) or manualCollectionId (advanced)
          itemId, // Canonical param from itemSelector (basic) or manualItemId (advanced)
          ...rest
        } = params
        let parsedFieldData: any | undefined

        try {
          if (fieldData && (params.operation === 'create' || params.operation === 'update')) {
            parsedFieldData = JSON.parse(fieldData)
          }
        } catch (error: any) {
          throw new Error(`Invalid JSON input for ${params.operation} operation: ${error.message}`)
        }

        const effectiveSiteId = siteId ? String(siteId).trim() : ''
        const effectiveCollectionId = collectionId ? String(collectionId).trim() : ''
        const effectiveItemId = itemId ? String(itemId).trim() : ''

        const baseParams = {
          credential: oauthCredential,
          siteId: effectiveSiteId,
          collectionId: effectiveCollectionId,
          ...rest,
        }

        switch (params.operation) {
          case 'create':
          case 'update':
            return {
              ...baseParams,
              itemId: effectiveItemId || undefined,
              fieldData: parsedFieldData,
            }
          case 'get':
          case 'delete':
            return { ...baseParams, itemId: effectiveItemId }
          default:
            return baseParams
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    oauthCredential: { type: 'string', description: 'Webflow OAuth access token' },
    siteId: { type: 'string', description: 'Webflow site identifier' },
    collectionId: { type: 'string', description: 'Webflow collection identifier' },
    itemId: { type: 'string', description: 'Item identifier' },
    offset: { type: 'number', description: 'Pagination offset' },
    limit: { type: 'number', description: 'Maximum items to return' },
    fieldData: { type: 'json', description: 'Item field data' },
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

export const WebflowBlockMeta = {
  tags: ['content-management', 'seo'],
  templates: [
    {
      icon: WebflowIcon,
      title: 'Webflow lead capture pipeline',
      prompt:
        'Create a workflow that monitors new Webflow form submissions, enriches each lead with company and contact data using Apollo and web search, adds them to a tracking table with a lead score, and sends a Slack notification to the sales team for high-potential leads.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'automation'],
      alsoIntegrations: ['apollo', 'slack'],
    },
    {
      icon: WebflowIcon,
      title: 'Webflow CMS publisher',
      prompt:
        'Create a workflow that reads a draft articles table, generates an SEO-optimized post, publishes it as a Webflow CMS item, and writes the live URL back to the row.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'content'],
    },
    {
      icon: WebflowIcon,
      title: 'Webflow form-to-CRM',
      prompt:
        'Build a workflow that watches Webflow form submissions, enriches each with Apollo company data, and pushes qualifying leads into HubSpot with the right owner and source.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['apollo', 'hubspot'],
    },
    {
      icon: WebflowIcon,
      title: 'Webflow content auditor',
      prompt:
        'Create a scheduled monthly workflow that audits Webflow CMS items for missing meta descriptions, broken links, or stale dates, and writes a remediation backlog.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'monitoring'],
    },
    {
      icon: WebflowIcon,
      title: 'Webflow site backup',
      prompt:
        'Build a scheduled workflow that exports a Webflow site’s CMS items and assets to S3 nightly with versioning, and writes the backup manifest to a tracking table.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'sync'],
      alsoIntegrations: ['s3'],
    },
    {
      icon: WebflowIcon,
      title: 'Webflow ecommerce inventory sync',
      prompt:
        'Create a workflow that mirrors Shopify product inventory and pricing into a Webflow store, ensures both stay in sync, and posts conflict alerts to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['ecommerce', 'sync'],
      alsoIntegrations: ['shopify', 'slack'],
    },
    {
      icon: WebflowIcon,
      title: 'Webflow + Hubspot lead-magnet',
      prompt:
        'Build a workflow that triggers on a Webflow form submission for a lead magnet, sends the asset via Loops, and writes the engagement to the matching HubSpot contact.',
      modules: ['agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'crm'],
      alsoIntegrations: ['loops', 'hubspot'],
    },
  ],
} as const satisfies BlockMeta
