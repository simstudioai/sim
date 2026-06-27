import { ConvexBlockDisplay } from '@/blocks/blocks/convex.display'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { ConvexResponse } from '@/tools/convex/types'

export const ConvexBlock: BlockConfig<ConvexResponse> = {
  ...ConvexBlockDisplay,
  authMode: AuthMode.ApiKey,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Run Query', id: 'query' },
        { label: 'Run Mutation', id: 'mutation' },
        { label: 'Run Action', id: 'action' },
        { label: 'Run Function', id: 'run_function' },
        { label: 'List Tables', id: 'list_tables' },
        { label: 'List Documents', id: 'list_documents' },
        { label: 'Document Deltas', id: 'document_deltas' },
      ],
      value: () => 'query',
    },
    {
      id: 'deploymentUrl',
      title: 'Deployment URL',
      type: 'short-input',
      placeholder: 'https://your-deployment.convex.cloud',
      required: true,
    },
    {
      id: 'deployKey',
      title: 'Deploy Key',
      type: 'short-input',
      placeholder: 'Your Convex deploy key',
      password: true,
      required: true,
    },
    {
      id: 'functionPath',
      title: 'Function Path',
      type: 'short-input',
      placeholder: 'messages:list',
      condition: { field: 'operation', value: ['query', 'mutation', 'action', 'run_function'] },
      required: true,
    },
    {
      id: 'args',
      title: 'Function Arguments',
      type: 'code',
      placeholder: '{\n  "key": "value"\n}',
      condition: { field: 'operation', value: ['query', 'mutation', 'action', 'run_function'] },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Generate a JSON object of named arguments for a Convex function based on the user's request.

### CONTEXT
{context}

### RULES
- Convex functions take a single object of named arguments
- Keys must match the argument names declared by the function
- Values must be JSON-serializable (strings, numbers, booleans, arrays, objects, null)

### EXAMPLES
"send a message saying hello from sim" -> {"body": "hello from sim", "author": "sim"}
"list the 10 most recent items" -> {"limit": 10}

Return ONLY the JSON object - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the arguments to pass...',
        generationType: 'json-object',
      },
    },
    {
      id: 'tableName',
      title: 'Table',
      type: 'short-input',
      placeholder: 'Table name (leave empty for all tables)',
      condition: { field: 'operation', value: ['list_documents', 'document_deltas'] },
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Snapshot value from List Documents or cursor from a previous page',
      condition: { field: 'operation', value: 'document_deltas' },
      required: true,
    },
    {
      id: 'snapshot',
      title: 'Snapshot',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Snapshot timestamp from a previous page',
      condition: { field: 'operation', value: 'list_documents' },
    },
    {
      id: 'pageCursor',
      title: 'Cursor',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Cursor from a previous page',
      condition: { field: 'operation', value: 'list_documents' },
    },
  ],
  tools: {
    access: [
      'convex_query',
      'convex_mutation',
      'convex_action',
      'convex_run_function',
      'convex_list_tables',
      'convex_list_documents',
      'convex_document_deltas',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'query':
            return 'convex_query'
          case 'mutation':
            return 'convex_mutation'
          case 'action':
            return 'convex_action'
          case 'run_function':
            return 'convex_run_function'
          case 'list_tables':
            return 'convex_list_tables'
          case 'list_documents':
            return 'convex_list_documents'
          case 'document_deltas':
            return 'convex_document_deltas'
          default:
            throw new Error(`Invalid Convex operation: ${params.operation}`)
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    deploymentUrl: { type: 'string', description: 'Convex deployment URL' },
    deployKey: { type: 'string', description: 'Convex deploy key' },
    functionPath: { type: 'string', description: 'Function path (e.g., messages:list)' },
    args: { type: 'json', description: 'Named arguments for the function' },
    tableName: { type: 'string', description: 'Table to read from (empty for all tables)' },
    snapshot: { type: 'string', description: 'Snapshot timestamp for List Documents pagination' },
    cursor: { type: 'string', description: 'Timestamp cursor for Document Deltas' },
    pageCursor: { type: 'string', description: 'Page cursor for List Documents pagination' },
  },
  outputs: {
    value: {
      type: 'json',
      description: 'Result returned by the query, mutation, or action function',
    },
    logLines: {
      type: 'array',
      description: 'Log lines printed during the function execution',
    },
    tables: {
      type: 'array',
      description: 'Names of the tables in the deployment',
    },
    schemas: {
      type: 'json',
      description: 'Map of table name to the JSON schema of its documents',
    },
    documents: {
      type: 'array',
      description: 'Documents returned by List Documents or Document Deltas',
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether more pages remain',
    },
    snapshot: {
      type: 'string',
      description: 'Snapshot timestamp to pass back in for the next List Documents page',
    },
    pageCursor: {
      type: 'string',
      description: 'Page cursor to pass back in for the next List Documents page',
    },
    cursor: {
      type: 'string',
      description: 'Timestamp cursor to pass back in for the next Document Deltas page',
    },
  },
}
