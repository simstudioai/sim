import { ElasticsearchIcon } from '@/components/icons'
import { ElasticsearchBlockDisplay } from '@/blocks/blocks/elasticsearch.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { ElasticsearchResponse } from '@/tools/elasticsearch/types'

export const ElasticsearchBlock: BlockConfig<ElasticsearchResponse> = {
  ...ElasticsearchBlockDisplay,
  authMode: AuthMode.ApiKey,
  subBlocks: [
    // Operation selector
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // Document Operations
        { label: 'Search', id: 'elasticsearch_search' },
        { label: 'Index Document', id: 'elasticsearch_index_document' },
        { label: 'Get Document', id: 'elasticsearch_get_document' },
        { label: 'Update Document', id: 'elasticsearch_update_document' },
        { label: 'Delete Document', id: 'elasticsearch_delete_document' },
        { label: 'Bulk Operations', id: 'elasticsearch_bulk' },
        { label: 'Count Documents', id: 'elasticsearch_count' },
        // Index Management
        { label: 'Create Index', id: 'elasticsearch_create_index' },
        { label: 'Delete Index', id: 'elasticsearch_delete_index' },
        { label: 'Get Index Info', id: 'elasticsearch_get_index' },
        { label: 'List Indices', id: 'elasticsearch_list_indices' },
        // Cluster Operations
        { label: 'Cluster Health', id: 'elasticsearch_cluster_health' },
        { label: 'Cluster Stats', id: 'elasticsearch_cluster_stats' },
      ],
      value: () => 'elasticsearch_search',
    },

    // Deployment type
    {
      id: 'deploymentType',
      title: 'Deployment Type',
      type: 'dropdown',
      options: [
        { label: 'Self-Hosted', id: 'self_hosted' },
        { label: 'Elastic Cloud', id: 'cloud' },
      ],
      value: () => 'self_hosted',
    },

    // Self-hosted host
    {
      id: 'host',
      title: 'Elasticsearch Host',
      type: 'short-input',
      placeholder: 'https://localhost:9200',
      required: true,
      condition: { field: 'deploymentType', value: 'self_hosted' },
      dependsOn: ['deploymentType'],
    },

    // Cloud ID
    {
      id: 'cloudId',
      title: 'Cloud ID',
      type: 'short-input',
      placeholder: 'deployment-name:base64-encoded-data',
      required: true,
      condition: { field: 'deploymentType', value: 'cloud' },
      dependsOn: ['deploymentType'],
    },

    // Authentication method
    {
      id: 'authMethod',
      title: 'Authentication Method',
      type: 'dropdown',
      options: [
        { label: 'API Key', id: 'api_key' },
        { label: 'Basic Auth', id: 'basic_auth' },
      ],
      value: () => 'api_key',
    },

    // API Key
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter encoded API key',
      password: true,
      required: true,
      condition: { field: 'authMethod', value: 'api_key' },
      dependsOn: ['authMethod'],
    },

    // Username
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'Enter username',
      required: true,
      condition: { field: 'authMethod', value: 'basic_auth' },
      dependsOn: ['authMethod'],
    },

    // Password
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      placeholder: 'Enter password',
      password: true,
      required: true,
      condition: { field: 'authMethod', value: 'basic_auth' },
      dependsOn: ['authMethod'],
    },

    // Index name - for most operations
    {
      id: 'index',
      title: 'Index Name',
      type: 'short-input',
      placeholder: 'my-index',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'elasticsearch_search',
          'elasticsearch_index_document',
          'elasticsearch_get_document',
          'elasticsearch_update_document',
          'elasticsearch_delete_document',
          'elasticsearch_bulk',
          'elasticsearch_count',
          'elasticsearch_create_index',
          'elasticsearch_delete_index',
          'elasticsearch_get_index',
        ],
      },
    },

    // Document ID - for get/update/delete
    {
      id: 'documentId',
      title: 'Document ID',
      type: 'short-input',
      placeholder: 'unique-document-id',
      required: true,
      condition: {
        field: 'operation',
        value: [
          'elasticsearch_get_document',
          'elasticsearch_update_document',
          'elasticsearch_delete_document',
        ],
      },
    },

    // Optional Document ID - for index document
    {
      id: 'documentId',
      title: 'Document ID',
      type: 'short-input',
      placeholder: 'Leave empty for auto-generated ID',
      condition: { field: 'operation', value: 'elasticsearch_index_document' },
    },

    // Document body - for index
    {
      id: 'document',
      title: 'Document',
      type: 'code',
      placeholder: '{ "field": "value", "another_field": 123 }',
      required: true,
      condition: { field: 'operation', value: 'elasticsearch_index_document' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an Elasticsearch document JSON object based on the user's description.
The document should contain the fields and values to be indexed.
Use appropriate data types (strings, numbers, booleans, arrays, nested objects).

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the document you want to index...',
        generationType: 'json-object',
      },
    },

    // Document body - for update (partial)
    {
      id: 'document',
      title: 'Partial Document',
      type: 'code',
      placeholder: '{ "field_to_update": "new_value" }',
      required: true,
      condition: { field: 'operation', value: 'elasticsearch_update_document' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an Elasticsearch partial document JSON for updating based on the user's description.
Only include the fields that need to be updated - other fields will remain unchanged.

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the fields you want to update...',
        generationType: 'json-object',
      },
    },

    // Search query
    {
      id: 'query',
      title: 'Search Query',
      type: 'code',
      placeholder: '{ "match": { "field": "search term" } }',
      condition: { field: 'operation', value: 'elasticsearch_search' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an Elasticsearch query DSL JSON based on the user's description.
Common query types:
- {"match": {"field": "text"}} - Full-text search
- {"term": {"field": "exact_value"}} - Exact match
- {"range": {"field": {"gte": 10, "lte": 100}}} - Range query
- {"bool": {"must": [...], "filter": [...]}} - Boolean combinations

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe what you want to search for...',
        generationType: 'json-object',
      },
    },

    // Count query
    {
      id: 'query',
      title: 'Query',
      type: 'code',
      placeholder: '{ "match": { "field": "value" } }',
      condition: { field: 'operation', value: 'elasticsearch_count' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an Elasticsearch query DSL JSON for counting documents based on the user's description.
Common query types:
- {"match": {"field": "text"}} - Full-text search
- {"term": {"field": "exact_value"}} - Exact match
- {"range": {"field": {"gte": 10}}} - Range query

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe which documents to count...',
        generationType: 'json-object',
      },
    },

    // Search size
    {
      id: 'size',
      title: 'Number of Results',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'elasticsearch_search' },
    },

    // Search from (offset)
    {
      id: 'from',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'elasticsearch_search' },
    },

    // Sort
    {
      id: 'sort',
      title: 'Sort',
      type: 'code',
      placeholder: '[{ "field": { "order": "asc" } }]',
      condition: { field: 'operation', value: 'elasticsearch_search' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an Elasticsearch sort specification JSON array based on the user's description.
Format: [{"field_name": {"order": "asc"|"desc"}}]
Examples:
- [{"timestamp": {"order": "desc"}}] - Sort by timestamp descending
- [{"_score": {"order": "desc"}}, {"date": {"order": "asc"}}] - Multi-field sort

Return ONLY valid JSON array - no explanations, no markdown code blocks.`,
        placeholder: 'Describe how to sort the results...',
        generationType: 'json-object',
      },
    },

    // Source includes
    {
      id: 'sourceIncludes',
      title: 'Fields to Include',
      type: 'short-input',
      placeholder: 'field1, field2 (comma-separated)',
      condition: {
        field: 'operation',
        value: ['elasticsearch_search', 'elasticsearch_get_document'],
      },
    },

    // Source excludes
    {
      id: 'sourceExcludes',
      title: 'Fields to Exclude',
      type: 'short-input',
      placeholder: 'field1, field2 (comma-separated)',
      condition: {
        field: 'operation',
        value: ['elasticsearch_search', 'elasticsearch_get_document'],
      },
    },

    // Bulk operations
    {
      id: 'operations',
      title: 'Bulk Operations',
      type: 'code',
      placeholder:
        '{ "index": { "_index": "my-index", "_id": "1" } }\n{ "field": "value" }\n{ "delete": { "_index": "my-index", "_id": "2" } }',
      required: true,
      condition: { field: 'operation', value: 'elasticsearch_bulk' },
      wandConfig: {
        enabled: true,
        prompt: `Generate Elasticsearch bulk operations in NDJSON format based on the user's description.
Each operation consists of an action line followed by an optional document line.
Actions: index, create, update, delete
Format:
{"index": {"_index": "my-index", "_id": "1"}}
{"field": "value"}
{"delete": {"_index": "my-index", "_id": "2"}}

Return ONLY the NDJSON content - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the bulk operations you want to perform...',
        generationType: 'json-object',
      },
    },

    // Index settings
    {
      id: 'settings',
      title: 'Index Settings',
      type: 'code',
      placeholder: '{ "number_of_shards": 1, "number_of_replicas": 1 }',
      condition: { field: 'operation', value: 'elasticsearch_create_index' },
      wandConfig: {
        enabled: true,
        prompt: `Generate Elasticsearch index settings JSON based on the user's description.
Common settings:
- "number_of_shards": Number of primary shards
- "number_of_replicas": Number of replica shards
- "refresh_interval": How often to refresh the index
- "analysis": Custom analyzers, tokenizers, filters

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the index settings you need...',
        generationType: 'json-object',
      },
    },

    // Index mappings
    {
      id: 'mappings',
      title: 'Index Mappings',
      type: 'code',
      placeholder: '{ "properties": { "field": { "type": "text" } } }',
      condition: { field: 'operation', value: 'elasticsearch_create_index' },
      wandConfig: {
        enabled: true,
        prompt: `Generate Elasticsearch index mappings JSON based on the user's description.
Define field types and properties:
- "text": Full-text searchable
- "keyword": Exact match, sorting, aggregations
- "integer", "long", "float", "double": Numeric types
- "date": Date/time values
- "boolean": True/false values
- "object", "nested": Complex types

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the fields and their types...',
        generationType: 'json-object',
      },
    },

    // Refresh option
    {
      id: 'refresh',
      title: 'Refresh',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Wait For', id: 'wait_for' },
        { label: 'Immediate', id: 'true' },
        { label: 'None', id: 'false' },
      ],
      value: () => '',
      condition: {
        field: 'operation',
        value: [
          'elasticsearch_index_document',
          'elasticsearch_delete_document',
          'elasticsearch_bulk',
        ],
      },
    },

    // Cluster health wait for status
    {
      id: 'waitForStatus',
      title: 'Wait for Status',
      type: 'dropdown',
      options: [
        { label: 'None', id: '' },
        { label: 'Green', id: 'green' },
        { label: 'Yellow', id: 'yellow' },
        { label: 'Red', id: 'red' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'elasticsearch_cluster_health' },
    },

    // Cluster health timeout
    {
      id: 'timeout',
      title: 'Timeout (seconds)',
      type: 'short-input',
      placeholder: '30',
      condition: { field: 'operation', value: 'elasticsearch_cluster_health' },
    },

    // Retry on conflict
    {
      id: 'retryOnConflict',
      title: 'Retry on Conflict',
      type: 'short-input',
      placeholder: '3',
      condition: { field: 'operation', value: 'elasticsearch_update_document' },
    },
  ],

  tools: {
    access: [
      'elasticsearch_search',
      'elasticsearch_index_document',
      'elasticsearch_get_document',
      'elasticsearch_update_document',
      'elasticsearch_delete_document',
      'elasticsearch_bulk',
      'elasticsearch_count',
      'elasticsearch_create_index',
      'elasticsearch_delete_index',
      'elasticsearch_get_index',
      'elasticsearch_cluster_health',
      'elasticsearch_cluster_stats',
      'elasticsearch_list_indices',
    ],
    config: {
      tool: (params) => {
        // Return the operation as the tool ID
        return params.operation || 'elasticsearch_search'
      },
      params: (params) => {
        const result: Record<string, unknown> = {}
        if (params.size) result.size = Number(params.size)
        if (params.from) result.from = Number(params.from)
        if (params.retryOnConflict) result.retryOnConflict = Number(params.retryOnConflict)
        if (params.timeout && typeof params.timeout === 'string') {
          result.timeout = params.timeout.endsWith('s') ? params.timeout : `${params.timeout}s`
        }
        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    deploymentType: { type: 'string', description: 'self_hosted or cloud' },
    host: { type: 'string', description: 'Elasticsearch host URL' },
    cloudId: { type: 'string', description: 'Elastic Cloud ID' },
    authMethod: { type: 'string', description: 'api_key or basic_auth' },
    apiKey: { type: 'string', description: 'API key for authentication' },
    username: { type: 'string', description: 'Username for basic auth' },
    password: { type: 'string', description: 'Password for basic auth' },
    index: { type: 'string', description: 'Index name' },
    documentId: { type: 'string', description: 'Document ID' },
    document: { type: 'string', description: 'Document body as JSON' },
    query: { type: 'string', description: 'Search query as JSON' },
    size: { type: 'number', description: 'Number of results' },
    from: { type: 'number', description: 'Starting offset' },
    sort: { type: 'string', description: 'Sort specification as JSON' },
    sourceIncludes: { type: 'string', description: 'Fields to include' },
    sourceExcludes: { type: 'string', description: 'Fields to exclude' },
    operations: { type: 'string', description: 'Bulk operations as NDJSON' },
    settings: { type: 'string', description: 'Index settings as JSON' },
    mappings: { type: 'string', description: 'Index mappings as JSON' },
    refresh: { type: 'string', description: 'Refresh policy' },
    waitForStatus: { type: 'string', description: 'Wait for cluster status' },
    timeout: { type: 'string', description: 'Timeout for wait operations' },
    retryOnConflict: { type: 'number', description: 'Retry attempts on conflict' },
  },

  outputs: {
    // Search outputs
    hits: { type: 'json', description: 'Search results' },
    took: { type: 'number', description: 'Time taken in milliseconds' },
    timed_out: { type: 'boolean', description: 'Whether the operation timed out' },
    aggregations: { type: 'json', description: 'Aggregation results' },
    // Document outputs
    _index: { type: 'string', description: 'Index name' },
    _id: { type: 'string', description: 'Document ID' },
    _version: { type: 'number', description: 'Document version' },
    _source: { type: 'json', description: 'Document content' },
    result: { type: 'string', description: 'Operation result' },
    found: { type: 'boolean', description: 'Whether document was found' },
    // Bulk outputs
    errors: { type: 'boolean', description: 'Whether any errors occurred' },
    items: { type: 'json', description: 'Bulk operation results' },
    // Count outputs
    count: { type: 'number', description: 'Document count' },
    // Index outputs
    acknowledged: { type: 'boolean', description: 'Whether operation was acknowledged' },
    // Cluster outputs
    cluster_name: { type: 'string', description: 'Cluster name' },
    status: { type: 'string', description: 'Cluster health status' },
    number_of_nodes: { type: 'number', description: 'Number of nodes' },
    indices: { type: 'json', description: 'Index statistics' },
    nodes: { type: 'json', description: 'Node statistics' },
  },
}

export const ElasticsearchBlockMeta = {
  tags: ['vector-search', 'data-analytics'],
  url: 'https://www.elastic.co/elasticsearch',
  templates: [
    {
      icon: ElasticsearchIcon,
      title: 'Elasticsearch log triage',
      prompt:
        'Build a scheduled workflow that runs saved Elasticsearch queries hourly for error patterns, clusters the matches, writes the top groups to a triage table, and pings on-call.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['pagerduty'],
    },
    {
      icon: ElasticsearchIcon,
      title: 'Elasticsearch security event correlator',
      prompt:
        'Create a workflow that pulls Elasticsearch security events, correlates them across sources, and opens a CrowdStrike or PagerDuty incident on a confirmed pattern.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring'],
      alsoIntegrations: ['crowdstrike', 'pagerduty'],
    },
    {
      icon: ElasticsearchIcon,
      title: 'Elasticsearch index lifecycle audit',
      prompt:
        'Build a scheduled weekly workflow that audits Elasticsearch indices against retention policies, identifies over-retained data, and writes the cleanup plan to a Slack approval thread.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ElasticsearchIcon,
      title: 'Elasticsearch search-as-a-service connector',
      prompt:
        'Create a workflow that exposes a saved Elasticsearch query as an internal search endpoint, normalizes results into a standard shape, and writes usage telemetry to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
    },
    {
      icon: ElasticsearchIcon,
      title: 'Elasticsearch + knowledge base hybrid',
      prompt:
        'Build a workflow that combines Elasticsearch keyword search with a vector knowledge base, fuses results with reciprocal-rank fusion, and answers user questions with grounded citations.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'research'],
    },
    {
      icon: ElasticsearchIcon,
      title: 'Elasticsearch slow-query digest',
      prompt:
        'Create a scheduled daily workflow that aggregates Elasticsearch slow-log entries, clusters the top offenders, and posts a digest to the platform Slack channel with recommended fixes.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'devops'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ElasticsearchIcon,
      title: 'Elasticsearch + LangSmith retrieval evaluator',
      prompt:
        'Create a workflow that uses LangSmith to evaluate retrieval quality from Elasticsearch versus a vector knowledge base, writes the head-to-head scores to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'analysis'],
      alsoIntegrations: ['langsmith'],
    },
  ],
  skills: [
    {
      name: 'search-elasticsearch-index',
      description: 'Run a query against an Elasticsearch index and return the matching documents.',
      content:
        '# Search Elasticsearch Index\n\nQuery an index and return the relevant documents.\n\n## Steps\n1. Confirm the connection details (host or cloud ID and auth) and the target index name.\n2. Choose the Search operation and build the query DSL — match for full-text, term for exact values, range for numeric or date bounds, and bool to combine clauses.\n3. Set size and offset for paging, add a sort spec when ordering matters, and use source includes/excludes to trim returned fields.\n\n## Output\nReturn the matching hits with their _id, _score, and relevant _source fields, plus the total count and query time. If nothing matched, report zero hits and suggest loosening the query.',
    },
    {
      name: 'index-document',
      description: 'Add or update a document in an Elasticsearch index.',
      content:
        '# Index Document\n\nWrite a document into an Elasticsearch index so it becomes searchable.\n\n## Steps\n1. Confirm the connection details and target index.\n2. Build the document as a JSON object with appropriate field types. Choose the Index Document operation; supply a document ID to upsert a known record, or omit it to let Elasticsearch auto-generate one.\n3. To change only specific fields of an existing document, use Update Document with a partial document and the document ID instead.\n4. Set the refresh policy to immediate or wait-for when the write must be searchable right away.\n\n## Output\nReturn the resulting _id, _version, and the operation result (created or updated).',
    },
    {
      name: 'bulk-load-documents',
      description:
        'Index, update, or delete many Elasticsearch documents in a single bulk request.',
      content:
        '# Bulk Load Documents\n\nApply many document operations to Elasticsearch efficiently in one call.\n\n## Steps\n1. Confirm the connection details and target index.\n2. Assemble the operations as NDJSON: an action line (index, create, update, or delete) followed by the document line where required.\n3. Run the Bulk Operations call and set a refresh policy if the data must be immediately searchable.\n\n## Output\nReport whether any errors occurred and summarize the per-item results — how many succeeded versus failed and the reason for any failures.',
    },
    {
      name: 'check-cluster-health',
      description: 'Report Elasticsearch cluster health and key index statistics.',
      content:
        '# Check Cluster Health\n\nAssess the health of an Elasticsearch deployment.\n\n## Steps\n1. Confirm the connection details.\n2. Call Cluster Health to get the overall status (green, yellow, red) and node count. Optionally wait for a target status.\n3. Use List Indices and Get Index Info to spot oversized, unassigned, or unhealthy indices, and Cluster Stats for storage and shard totals.\n\n## Output\nReport the cluster status, number of nodes, and any indices that look problematic. If status is yellow or red, explain the likely cause (e.g., unassigned replicas) and what to check next.',
    },
  ],
} as const satisfies BlockMeta
