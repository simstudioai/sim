import { WebflowIcon } from '@/components/icons'
import { getScopesForService } from '@/lib/oauth/utils'
import { WebflowBlockDisplay } from '@/blocks/blocks/webflow.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { WebflowResponse } from '@/tools/webflow/types'
import { getTrigger } from '@/triggers'

export const WebflowBlock: BlockConfig<WebflowResponse> = {
  ...WebflowBlockDisplay,
  authMode: AuthMode.OAuth,
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
  url: 'https://webflow.com',
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
      title: 'Webflow CMS backup',
      prompt:
        'Build a scheduled workflow that exports every item from a Webflow CMS collection to S3 nightly with versioning, and writes the backup manifest to a tracking table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'sync'],
      alsoIntegrations: ['s3'],
    },
    {
      icon: WebflowIcon,
      title: 'Webflow product catalog sync',
      prompt:
        'Create a scheduled workflow that mirrors Shopify products and pricing into a Webflow CMS product collection, keeps both in sync, and posts conflict alerts to Slack.',
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
  skills: [
    {
      name: 'publish-cms-item',
      description:
        'Create a new item in a Webflow CMS collection from supplied or generated field data.',
      content:
        '# Publish a Webflow CMS Item\n\nTurn structured content into a live Webflow CMS collection item.\n\n## Steps\n1. Identify the target site and collection. If unknown, list collections to confirm the collection ID and its field schema.\n2. Map the incoming content to the collection fields, including required fields like name and slug. Generate a URL-safe slug if one is not provided.\n3. Call the create-item operation with the assembled fieldData JSON.\n4. Confirm the new item ID and slug returned by the API.\n\n## Output\nReport the created item ID, slug, and the live or staged URL. If a required field was missing, name it explicitly rather than guessing a value.',
    },
    {
      name: 'update-cms-item',
      description:
        'Find a Webflow CMS item and update specific fields without disturbing the rest.',
      content:
        '# Update a Webflow CMS Item\n\nApply targeted edits to an existing collection item.\n\n## Steps\n1. Resolve the item by ID, or list items in the collection and match on slug or name.\n2. Get the current item so existing field values are known.\n3. Build fieldData containing only the fields that change, merged onto the current values so untouched fields are preserved.\n4. Call the update-item operation and confirm the change took effect.\n\n## Output\nList exactly which fields changed and their new values. Note the item ID and whether the change is live or staged.',
    },
    {
      name: 'audit-collection-content',
      description:
        'List items in a Webflow collection and flag missing or stale fields for cleanup.',
      content:
        '# Audit a Webflow Collection\n\nReview a CMS collection for content-quality gaps.\n\n## Steps\n1. List all items in the target collection, paging through with offset and limit until complete.\n2. For each item, check for empty required fields such as meta description, image, or publish date.\n3. Flag items that are missing key SEO or display fields, or whose dates look stale.\n4. Summarize the findings as a remediation backlog.\n\n## Output\nReturn a table of flagged items with item ID, slug, and the specific gap found. End with a short prioritized list of what to fix first.',
    },
  ],
} as const satisfies BlockMeta
