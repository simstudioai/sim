import { AlgoliaIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

export const AlgoliaBlock: BlockConfig = {
  type: 'algolia',
  name: 'Algolia',
  description: 'Search and manage Algolia indices',
  longDescription:
    'Integrate Algolia into your workflow. Search indices, manage records (add, update, delete, browse), configure index settings, and perform batch operations.',
  docsLink: 'https://docs.sim.ai/integrations/algolia',
  category: 'tools',
  integrationType: IntegrationType.Search,
  bgColor: '#003DFF',
  iconColor: '#003DFF',
  icon: AlgoliaIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Search', id: 'search' },
        { label: 'Add Record', id: 'add_record' },
        { label: 'Get Record', id: 'get_record' },
        { label: 'Get Records', id: 'get_records' },
        { label: 'Partial Update Record', id: 'partial_update_record' },
        { label: 'Delete Record', id: 'delete_record' },
        { label: 'Browse Records', id: 'browse_records' },
        { label: 'Batch Operations', id: 'batch_operations' },
        { label: 'List Indices', id: 'list_indices' },
        { label: 'Get Settings', id: 'get_settings' },
        { label: 'Update Settings', id: 'update_settings' },
        { label: 'Delete Index', id: 'delete_index' },
        { label: 'Copy/Move Index', id: 'copy_move_index' },
        { label: 'Clear Records', id: 'clear_records' },
        { label: 'Delete By Filter', id: 'delete_by_filter' },
        { label: 'Get Task Status', id: 'get_task_status' },
      ],
      value: () => 'search',
    },
    // Index name - needed for all except list_indices
    {
      id: 'indexName',
      title: 'Index Name',
      type: 'short-input',
      placeholder: 'my_index',
      condition: { field: 'operation', value: 'list_indices', not: true },
      required: { field: 'operation', value: 'list_indices', not: true },
    },
    // Search fields
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Enter search query',
      condition: { field: 'operation', value: ['search', 'browse_records'] },
      required: { field: 'operation', value: 'search' },
    },
    {
      id: 'hitsPerPage',
      title: 'Hits Per Page',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: ['search', 'browse_records', 'list_indices'] },
      mode: 'advanced',
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: ['search', 'list_indices'] },
      mode: 'advanced',
    },
    {
      id: 'filters',
      title: 'Filters',
      type: 'short-input',
      placeholder: 'category:electronics AND price < 100',
      condition: { field: 'operation', value: ['search', 'browse_records'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate an Algolia filter expression based on the user's description.

Available operators: AND, OR, NOT
Comparison: =, !=, <, >, <=, >=
Facet filters: attribute:value
Numeric filters: attribute operator value
Boolean filters: attribute:true / attribute:false
Tag filters: _tags:value

Examples:
- "category:electronics AND price < 100"
- "brand:Apple OR brand:Samsung"
- "inStock:true AND NOT category:deprecated"
- "(category:electronics OR category:books) AND price >= 10"

Return ONLY the filter string, no quotes or explanation.`,
      },
    },
    {
      id: 'attributesToRetrieve',
      title: 'Attributes to Retrieve',
      type: 'short-input',
      placeholder: 'name,description,price',
      condition: { field: 'operation', value: ['search', 'get_record', 'browse_records'] },
      mode: 'advanced',
    },
    {
      id: 'facets',
      title: 'Facets',
      type: 'short-input',
      placeholder: 'category,brand (or * for all)',
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
    {
      id: 'getRankingInfo',
      title: 'Include Ranking Info',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
    // Browse cursor
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Cursor from previous browse response',
      condition: { field: 'operation', value: 'browse_records' },
      mode: 'advanced',
    },
    // Add record fields
    {
      id: 'record',
      title: 'Record',
      type: 'long-input',
      placeholder: '{"name": "Product", "price": 29.99}',
      condition: { field: 'operation', value: 'add_record' },
      required: { field: 'operation', value: 'add_record' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object for an Algolia record based on the user's description.

### CONTEXT
{context}

### GUIDELINES
- Return ONLY a valid JSON object starting with { and ending with }
- Include relevant attributes as key-value pairs
- Do NOT include objectID unless the user explicitly specifies one
- Use appropriate types: strings, numbers, booleans, arrays

### EXAMPLE
User: "A product with name, price, and categories"
Output:
{"name": "Example Product", "price": 29.99, "categories": ["electronics", "gadgets"]}

Return ONLY the JSON object.`,
        placeholder: 'Describe the record to add...',
        generationType: 'json-object',
      },
    },
    // Partial update fields
    {
      id: 'attributes',
      title: 'Attributes to Update',
      type: 'long-input',
      placeholder: '{"price": 24.99, "stock": {"_operation": "Decrement", "value": 1}}',
      condition: { field: 'operation', value: 'partial_update_record' },
      required: { field: 'operation', value: 'partial_update_record' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object for an Algolia partial update based on the user's description.

### CONTEXT
{context}

### GUIDELINES
- Return ONLY a valid JSON object starting with { and ending with }
- For simple updates, use key-value pairs: {"price": 24.99}
- For built-in operations, use the _operation syntax:
  - Increment: {"count": {"_operation": "Increment", "value": 1}}
  - Decrement: {"stock": {"_operation": "Decrement", "value": 1}}
  - Add to array: {"tags": {"_operation": "Add", "value": "new-tag"}}
  - Remove from array: {"tags": {"_operation": "Remove", "value": "old-tag"}}
  - AddUnique: {"tags": {"_operation": "AddUnique", "value": "unique-tag"}}
  - IncrementFrom: {"version": {"_operation": "IncrementFrom", "value": 0}}
  - IncrementSet: {"views": {"_operation": "IncrementSet", "value": 1}}

### EXAMPLE
User: "Decrease stock by 2 and add a sale tag"
Output:
{"stock": {"_operation": "Decrement", "value": 2}, "tags": {"_operation": "Add", "value": "sale"}}

Return ONLY the JSON object.`,
        placeholder: 'Describe the attributes to update...',
        generationType: 'json-object',
      },
    },
    {
      id: 'createIfNotExists',
      title: 'Create If Not Exists',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      condition: { field: 'operation', value: 'partial_update_record' },
      value: () => 'true',
      mode: 'advanced',
    },
    // Batch operations field
    {
      id: 'requests',
      title: 'Batch Requests',
      type: 'long-input',
      placeholder:
        '[{"action": "addObject", "body": {"name": "Item"}}, {"action": "deleteObject", "body": {"objectID": "123"}}]',
      condition: { field: 'operation', value: 'batch_operations' },
      required: { field: 'operation', value: 'batch_operations' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of Algolia batch operations based on the user's description.

### CONTEXT
{context}

### GUIDELINES
- Return ONLY a valid JSON array starting with [ and ending with ]
- Each item must have "action" and "body" properties
- Valid actions: addObject, updateObject, partialUpdateObject, partialUpdateObjectNoCreate, deleteObject, delete, clear
- For deleteObject, body must include objectID
- For updateObject, body must include objectID
- For addObject, objectID is optional (auto-generated if omitted)

### EXAMPLE
User: "Add two products and delete one with ID old-123"
Output:
[
  {"action": "addObject", "body": {"name": "Product A", "price": 19.99}},
  {"action": "addObject", "body": {"name": "Product B", "price": 29.99}},
  {"action": "deleteObject", "body": {"objectID": "old-123"}}
]

Return ONLY the JSON array.`,
        placeholder: 'Describe the batch operations to perform...',
        generationType: 'json-object',
      },
    },
    // Update settings fields
    {
      id: 'settings',
      title: 'Settings',
      type: 'long-input',
      placeholder:
        '{"searchableAttributes": ["name", "description"], "customRanking": ["desc(popularity)"]}',
      condition: { field: 'operation', value: 'update_settings' },
      required: { field: 'operation', value: 'update_settings' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a valid Algolia index settings JSON object based on the user's description.

### CONTEXT
{context}

### GUIDELINES
- Return ONLY a valid JSON object starting with { and ending with }
- Common settings include:
  - searchableAttributes: array of attribute names (ordered by priority)
  - attributesForFaceting: array of attributes for filtering/faceting (prefix with "filterOnly(" or "searchable(" as needed)
  - customRanking: array of "asc(attr)" or "desc(attr)" expressions
  - ranking: array of ranking criteria (e.g., "typo", "geo", "words", "filters", "proximity", "attribute", "exact", "custom")
  - replicas: array of replica index names
  - hitsPerPage: number of results per page
  - paginationLimitedTo: max pagination depth
  - highlightPreTag / highlightPostTag: HTML tags for highlighting

### EXAMPLE
User: "Make name and description searchable, add category faceting, rank by popularity"
Output:
{"searchableAttributes": ["name", "description"], "attributesForFaceting": ["category"], "customRanking": ["desc(popularity)"]}

Return ONLY the JSON object.`,
        placeholder: 'Describe the settings to apply...',
        generationType: 'json-object',
      },
    },
    {
      id: 'forwardToReplicas',
      title: 'Forward to Replicas',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      condition: { field: 'operation', value: 'update_settings' },
      value: () => 'false',
      mode: 'advanced',
    },
    // Copy/Move index fields
    {
      id: 'copyMoveOperation',
      title: 'Copy or Move',
      type: 'dropdown',
      options: [
        { label: 'Copy', id: 'copy' },
        { label: 'Move', id: 'move' },
      ],
      condition: { field: 'operation', value: 'copy_move_index' },
      value: () => 'copy',
    },
    {
      id: 'destination',
      title: 'Destination Index',
      type: 'short-input',
      placeholder: 'my_index_backup',
      condition: { field: 'operation', value: 'copy_move_index' },
      required: { field: 'operation', value: 'copy_move_index' },
    },
    {
      id: 'scope',
      title: 'Scope (Copy Only)',
      type: 'short-input',
      placeholder: '["settings", "synonyms", "rules"]',
      condition: { field: 'operation', value: 'copy_move_index' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of Algolia copy scopes based on the user's description.

### CONTEXT
{context}

### GUIDELINES
- Return ONLY a valid JSON array
- Valid scope values: "settings", "synonyms", "rules"
- Omitting scope copies everything including records
- Only applies to copy operations, not move

### EXAMPLE
User: "Copy only settings and synonyms"
Output:
["settings", "synonyms"]

Return ONLY the JSON array.`,
        placeholder: 'Describe what to copy...',
        generationType: 'json-object',
      },
    },
    // Delete by filter fields
    {
      id: 'deleteFilters',
      title: 'Filter Expression',
      type: 'short-input',
      placeholder: 'category:outdated AND price < 10',
      condition: { field: 'operation', value: 'delete_by_filter' },
      required: { field: 'operation', value: 'delete_by_filter' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an Algolia filter expression for deleting records based on the user's description.

Available operators: AND, OR, NOT
Comparison: =, !=, <, >, <=, >=
Facet filters: attribute:value
Numeric filters: attribute operator value

Examples:
- "category:outdated AND price < 10"
- "status:archived OR lastUpdated < 1609459200"
- "NOT category:active"

Return ONLY the filter string, no quotes or explanation.`,
      },
    },
    {
      id: 'facetFilters',
      title: 'Facet Filters',
      type: 'short-input',
      placeholder: '["brand:Acme"]',
      condition: { field: 'operation', value: 'delete_by_filter' },
      mode: 'advanced',
    },
    {
      id: 'numericFilters',
      title: 'Numeric Filters',
      type: 'short-input',
      placeholder: '["price > 100"]',
      condition: { field: 'operation', value: 'delete_by_filter' },
      mode: 'advanced',
    },
    {
      id: 'tagFilters',
      title: 'Tag Filters',
      type: 'short-input',
      placeholder: '["published", "archived"]',
      condition: { field: 'operation', value: 'delete_by_filter' },
      mode: 'advanced',
    },
    {
      id: 'aroundLatLng',
      title: 'Around Lat/Lng',
      type: 'short-input',
      placeholder: '40.71,-74.01',
      condition: { field: 'operation', value: ['delete_by_filter', 'search', 'browse_records'] },
      mode: 'advanced',
    },
    {
      id: 'aroundRadius',
      title: 'Around Radius (m)',
      type: 'short-input',
      placeholder: '1000 or "all"',
      condition: { field: 'operation', value: ['delete_by_filter', 'search', 'browse_records'] },
      mode: 'advanced',
    },
    {
      id: 'insideBoundingBox',
      title: 'Inside Bounding Box',
      type: 'short-input',
      placeholder: '[[47.3165,0.757,47.3424,0.8012]]',
      condition: { field: 'operation', value: ['delete_by_filter', 'search', 'browse_records'] },
      mode: 'advanced',
    },
    {
      id: 'insidePolygon',
      title: 'Inside Polygon',
      type: 'short-input',
      placeholder: '[[47.3165,0.757,47.3424,0.8012,47.33,0.78]]',
      condition: { field: 'operation', value: ['delete_by_filter', 'search', 'browse_records'] },
      mode: 'advanced',
    },
    // Get records (batch) field
    {
      id: 'getRecordsRequests',
      title: 'Record Requests',
      type: 'long-input',
      placeholder: '[{"objectID": "id1"}, {"objectID": "id2", "attributesToRetrieve": ["name"]}]',
      condition: { field: 'operation', value: 'get_records' },
      required: { field: 'operation', value: 'get_records' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of Algolia get-records requests based on the user's description.

### CONTEXT
{context}

### GUIDELINES
- Return ONLY a valid JSON array starting with [ and ending with ]
- Each item must have "objectID" (required)
- Optionally include "indexName" to fetch from a different index
- Optionally include "attributesToRetrieve" as an array of attribute names

### EXAMPLE
User: "Get products with IDs abc and xyz, only returning name and price"
Output:
[{"objectID": "abc", "attributesToRetrieve": ["name", "price"]}, {"objectID": "xyz", "attributesToRetrieve": ["name", "price"]}]

Return ONLY the JSON array.`,
        placeholder: 'Describe the records to retrieve...',
        generationType: 'json-object',
      },
    },
    // Get task status field
    {
      id: 'taskID',
      title: 'Task ID',
      type: 'short-input',
      placeholder: '12345',
      condition: { field: 'operation', value: 'get_task_status' },
      required: { field: 'operation', value: 'get_task_status' },
    },
    // Object ID - for add (optional), get, partial update, delete
    {
      id: 'objectID',
      title: 'Object ID',
      type: 'short-input',
      placeholder: 'my-record-123',
      condition: {
        field: 'operation',
        value: ['add_record', 'get_record', 'partial_update_record', 'delete_record'],
      },
      required: {
        field: 'operation',
        value: ['get_record', 'partial_update_record', 'delete_record'],
      },
    },
    // Common credentials
    {
      id: 'applicationId',
      title: 'Application ID',
      type: 'short-input',
      placeholder: 'Your Algolia Application ID',
      password: true,
      required: true,
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Your Algolia API Key',
      password: true,
      required: true,
    },
  ],

  tools: {
    access: [
      'algolia_search',
      'algolia_add_record',
      'algolia_get_record',
      'algolia_get_records',
      'algolia_partial_update_record',
      'algolia_delete_record',
      'algolia_browse_records',
      'algolia_batch_operations',
      'algolia_list_indices',
      'algolia_get_settings',
      'algolia_update_settings',
      'algolia_delete_index',
      'algolia_copy_move_index',
      'algolia_clear_records',
      'algolia_delete_by_filter',
      'algolia_get_task_status',
    ],
    config: {
      tool: (params: Record<string, unknown>) => `algolia_${params.operation}`,
      params: (params: Record<string, unknown>) => {
        const { operation, ...rest } = params
        const result: Record<string, unknown> = {}

        for (const [key, value] of Object.entries(rest)) {
          if (value === undefined || value === null || value === '') continue
          result[key] = value
        }

        if (operation === 'partial_update_record') {
          result.createIfNotExists = result.createIfNotExists !== 'false'
        }
        if (operation === 'update_settings') {
          result.forwardToReplicas = result.forwardToReplicas === 'true'
        }
        if (operation === 'search' && result.getRankingInfo !== undefined) {
          result.getRankingInfo = result.getRankingInfo === 'true'
        }
        if (operation === 'copy_move_index') {
          result.operation = result.copyMoveOperation
          result.copyMoveOperation = undefined
        }
        if (operation === 'delete_by_filter') {
          result.filters = result.deleteFilters
          result.deleteFilters = undefined
        }
        if (operation === 'get_records') {
          result.requests = result.getRecordsRequests
          result.getRecordsRequests = undefined
        }

        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    indexName: { type: 'string', description: 'Algolia index name' },
    query: { type: 'string', description: 'Search query' },
    hitsPerPage: { type: 'string', description: 'Number of hits per page' },
    page: { type: 'string', description: 'Page number' },
    filters: { type: 'string', description: 'Algolia filter string' },
    attributesToRetrieve: { type: 'string', description: 'Attributes to retrieve' },
    facets: { type: 'string', description: 'Comma-separated facet attribute names to count' },
    getRankingInfo: { type: 'string', description: 'Include detailed ranking info in each hit' },
    cursor: { type: 'string', description: 'Browse cursor for pagination' },
    record: { type: 'json', description: 'Record data to add' },
    attributes: { type: 'json', description: 'Attributes to partially update' },
    createIfNotExists: { type: 'string', description: 'Create record if not exists' },
    requests: { type: 'json', description: 'Batch operation requests' },
    settings: { type: 'json', description: 'Index settings to update' },
    forwardToReplicas: { type: 'string', description: 'Forward settings to replicas' },
    objectID: { type: 'string', description: 'Object ID' },
    copyMoveOperation: { type: 'string', description: 'Copy or move operation' },
    destination: { type: 'string', description: 'Destination index name' },
    scope: { type: 'json', description: 'Scopes to copy (settings, synonyms, rules)' },
    deleteFilters: { type: 'string', description: 'Filter expression for delete by filter' },
    facetFilters: { type: 'json', description: 'Facet filters for delete by filter' },
    numericFilters: { type: 'json', description: 'Numeric filters for delete by filter' },
    tagFilters: {
      type: 'json',
      description: 'Tag filters using the _tags attribute for delete by filter',
    },
    aroundLatLng: { type: 'string', description: 'Geo-search coordinates (lat,lng)' },
    aroundRadius: { type: 'string', description: 'Geo-search radius in meters or "all"' },
    insideBoundingBox: { type: 'json', description: 'Bounding box coordinates for geo-search' },
    insidePolygon: { type: 'json', description: 'Polygon coordinates for geo-search' },
    getRecordsRequests: {
      type: 'json',
      description: 'Array of objects with objectID to retrieve multiple records',
    },
    taskID: { type: 'string', description: 'Task ID returned by a previous write operation' },
    applicationId: { type: 'string', description: 'Algolia Application ID' },
    apiKey: { type: 'string', description: 'Algolia API Key' },
  },

  outputs: {
    hits: { type: 'array', description: 'Search result hits or browsed records' },
    nbHits: { type: 'number', description: 'Total number of hits' },
    page: { type: 'number', description: 'Current page number (zero-based)' },
    nbPages: { type: 'number', description: 'Total number of pages available' },
    hitsPerPage: { type: 'number', description: 'Number of hits per page' },
    processingTimeMS: {
      type: 'number',
      description: 'Server-side processing time in milliseconds',
    },
    query: { type: 'string', description: 'Search query that was executed' },
    parsedQuery: { type: 'string', description: 'Query after normalization and stop word removal' },
    facets: { type: 'json', description: 'Facet counts by facet name' },
    facets_stats: {
      type: 'json',
      description: 'Statistics (min, max, avg, sum) for numeric facets',
    },
    exhaustive: { type: 'json', description: 'Exhaustiveness flags for the search results' },
    taskID: { type: 'number', description: 'Algolia task ID for tracking async operations' },
    objectID: { type: 'string', description: 'Object ID of the affected record' },
    objectIDs: { type: 'array', description: 'Object IDs affected by batch operations' },
    createdAt: { type: 'string', description: 'ISO 8601 timestamp when the record was created' },
    updatedAt: {
      type: 'string',
      description: 'ISO 8601 timestamp when the record or settings were updated',
    },
    deletedAt: {
      type: 'string',
      description: 'ISO 8601 timestamp when the record or index was deleted',
    },
    record: { type: 'json', description: 'Retrieved record data (user-defined attributes)' },
    results: { type: 'array', description: 'Array of retrieved records from get_records' },
    cursor: {
      type: 'string',
      description:
        'Opaque cursor string for retrieving the next page of browse results. Absent when no more results exist.',
    },
    indices: { type: 'array', description: 'List of indices in the application' },
    searchableAttributes: { type: 'array', description: 'List of searchable attributes' },
    attributesForFaceting: { type: 'array', description: 'Attributes configured for faceting' },
    ranking: { type: 'array', description: 'Ranking criteria for the index' },
    customRanking: { type: 'array', description: 'Custom ranking criteria' },
    replicas: { type: 'array', description: 'List of replica index names' },
    maxValuesPerFacet: {
      type: 'number',
      description: 'Maximum number of facet values returned (default 100)',
    },
    highlightPreTag: {
      type: 'string',
      description: 'HTML tag inserted before highlighted parts (default "<em>")',
    },
    highlightPostTag: {
      type: 'string',
      description: 'HTML tag inserted after highlighted parts (default "</em>")',
    },
    paginationLimitedTo: {
      type: 'number',
      description: 'Maximum number of hits accessible via pagination (default 1000)',
    },
    status: {
      type: 'string',
      description: 'Task status: "published" once applied, "notPublished" while still pending',
    },
    pendingTask: { type: 'boolean', description: 'Whether the task is still pending' },
  },
}

export const AlgoliaBlockMeta = {
  tags: ['vector-search', 'knowledge-base'],
  url: 'https://www.algolia.com',
  templates: [
    {
      icon: AlgoliaIcon,
      title: 'Algolia content indexer',
      prompt:
        'Build a workflow that watches a content source — WordPress, knowledge base — and upserts records into an Algolia index, removing deleted items for accurate search.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'sync'],
      alsoIntegrations: ['wordpress'],
    },
    {
      icon: AlgoliaIcon,
      title: 'Algolia search-quality auditor',
      prompt:
        'Create a scheduled workflow that runs benchmark queries against an Algolia index weekly, scores top-result relevance, and writes a quality report.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'analysis'],
    },
    {
      icon: AlgoliaIcon,
      title: 'Algolia settings tuner',
      prompt:
        'Build a workflow that reads an Algolia index settings, has an agent propose improvements to searchable attributes and ranking, and applies the approved settings update.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
    },
    {
      icon: AlgoliaIcon,
      title: 'Algolia index reconciler',
      prompt:
        'Create a workflow that browses all records in an Algolia index, compares them against a source-of-truth table, and batches adds, updates, and deletes to keep the index accurate.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'sync'],
    },
    {
      icon: AlgoliaIcon,
      title: 'Algolia + knowledge base sync',
      prompt:
        'Build a workflow that mirrors a Sim knowledge base into an Algolia index, keeping vector retrieval and keyword search aligned for hybrid retrieval.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'sync'],
    },
    {
      icon: AlgoliaIcon,
      title: 'Algolia index inventory',
      prompt:
        'Create a scheduled workflow that lists all Algolia indices and their record counts, writes a daily inventory snapshot to a table, and pings on-call in Slack when an index record count drops unexpectedly.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AlgoliaIcon,
      title: 'Algolia stale-record sweeper',
      prompt:
        'Build a scheduled workflow that browses an Algolia index, flags records older than a freshness threshold, writes them to a cleanup table, and deletes the confirmed stale records.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
    },
  ],
  skills: [
    {
      name: 'answer-from-search-index',
      description:
        'Search an Algolia index for a user question and return a grounded answer with the matching records.',
      content:
        '# Answer From Search Index\n\nUse Algolia retrieval to answer questions over indexed content (docs, products, knowledge base).\n\n## Steps\n1. Take the user question and run a search against the relevant Algolia index.\n2. Apply filters or facets to narrow results (category, status, language) when appropriate.\n3. Read the top hits and synthesize an answer grounded only in the returned records.\n4. If no relevant hits are returned, say so rather than guessing.\n\n## Output\nA concise answer plus the titles and IDs of the records used. Do not invent content not present in the hits.',
    },
    {
      name: 'index-new-records',
      description:
        'Take new or updated content and push it into an Algolia index as searchable records.',
      content:
        '# Index New Records\n\nKeep an Algolia index in sync with new content.\n\n## Steps\n1. Collect the source items to index (products, articles, entries).\n2. Map each item to a record object with a stable objectID and the searchable/filterable attributes.\n3. Save the records to the target index, updating existing objectIDs in place.\n4. Verify by running a quick search for one of the new records.\n\n## Output\nReport how many records were added or updated and confirm one is retrievable via search.',
    },
    {
      name: 'audit-search-relevance',
      description:
        'Run a set of test queries against an Algolia index and report which return weak or empty results.',
      content:
        '# Audit Search Relevance\n\nCheck that important queries return good results from an Algolia index.\n\n## Steps\n1. Run each query in the provided test set against the index.\n2. Record the top results, total hit count, and whether the expected record appears.\n3. Flag queries that return zero hits, too many hits, or miss the expected record.\n\n## Output\nA table of queries with result counts and pass/fail, plus suggestions for synonyms or ranking tweaks where relevance is weak.',
    },
    {
      name: 'tune-index-ranking',
      description:
        'Read an Algolia index configuration, propose ranking and searchable-attribute changes, and apply the update.',
      content:
        '# Tune Index Ranking\n\nAdjust how an Algolia index ranks results without touching the underlying data.\n\n## Steps\n1. Fetch the current index settings (searchable attributes, custom ranking, ranking criteria).\n2. Compare them against the desired outcome (e.g., surface newer or more popular items first).\n3. Propose specific changes to customRanking, searchableAttributes order, or attributesForFaceting.\n4. Apply the approved settings update to the index.\n\n## Output\nA before/after summary of the settings changed and why, plus confirmation the update succeeded.',
    },
    {
      name: 'snapshot-index-before-change',
      description:
        'Copy an Algolia index to a timestamped backup before applying a risky settings or data change.',
      content:
        '# Snapshot Index Before Change\n\nProtect against a bad settings or batch update by copying the index first.\n\n## Steps\n1. Copy the source index to a new destination index named with a date or version suffix.\n2. Confirm the copy completed by checking the resulting task status.\n3. Apply the intended change (settings update, batch operation, or delete-by-filter) to the original index.\n4. If the change causes problems, the snapshot index can be copied back or used for comparison.\n\n## Output\nThe name of the backup index created and confirmation the source change was applied afterward.',
    },
  ],
} as const satisfies BlockMeta
