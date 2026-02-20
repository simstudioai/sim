import { AlgoliaIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'

export const AlgoliaBlock: BlockConfig = {
  type: 'algolia',
  name: 'Algolia',
  description: 'Search and manage Algolia indices',
  longDescription:
    'Integrate Algolia into your workflow. Search indices, manage records (add, update, delete, browse), configure index settings, and perform batch operations.',
  docsLink: 'https://docs.sim.ai/tools/algolia',
  category: 'tools',
  bgColor: '#003DFF',
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
      condition: { field: 'operation', value: ['search', 'browse_records'] },
      mode: 'advanced',
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'search' },
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
      condition: { field: 'operation', value: 'delete_by_filter' },
      mode: 'advanced',
    },
    {
      id: 'aroundRadius',
      title: 'Around Radius (m)',
      type: 'short-input',
      placeholder: '1000 or "all"',
      condition: { field: 'operation', value: 'delete_by_filter' },
      mode: 'advanced',
    },
    {
      id: 'insideBoundingBox',
      title: 'Inside Bounding Box',
      type: 'short-input',
      placeholder: '[[47.3165,0.757,47.3424,0.8012]]',
      condition: { field: 'operation', value: 'delete_by_filter' },
      mode: 'advanced',
    },
    {
      id: 'insidePolygon',
      title: 'Inside Polygon',
      type: 'short-input',
      placeholder: '[[47.3165,0.757,47.3424,0.8012,47.33,0.78]]',
      condition: { field: 'operation', value: 'delete_by_filter' },
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
    // List indices pagination
    {
      id: 'listPage',
      title: 'Page',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'list_indices' },
      mode: 'advanced',
    },
    {
      id: 'listHitsPerPage',
      title: 'Indices Per Page',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'list_indices' },
      mode: 'advanced',
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
    ],
    config: {
      tool: (params: Record<string, unknown>) => {
        const op = params.operation as string
        if (op === 'partial_update_record') {
          params.createIfNotExists = params.createIfNotExists !== 'false'
        }
        if (op === 'update_settings' && params.forwardToReplicas === 'true') {
          params.forwardToReplicas = true
        } else if (op === 'update_settings') {
          params.forwardToReplicas = false
        }
        if (op === 'copy_move_index') {
          params.operation = params.copyMoveOperation
        }
        if (op === 'delete_by_filter') {
          params.filters = params.deleteFilters
        }
        if (op === 'get_records') {
          params.requests = params.getRecordsRequests
        }
        if (op === 'list_indices') {
          if (params.listPage !== undefined) params.page = params.listPage
          if (params.listHitsPerPage !== undefined) params.hitsPerPage = params.listHitsPerPage
        }
        return `algolia_${op}`
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
    listPage: { type: 'string', description: 'Page number for list indices pagination' },
    listHitsPerPage: { type: 'string', description: 'Indices per page for list indices' },
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
  },
}
