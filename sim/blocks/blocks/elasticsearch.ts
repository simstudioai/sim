import { ElasticsearchIcon } from '@/components/icons'
import { ElasticsearchResponse } from '@/tools/databases/elasticsearch/types'
import { BlockConfig } from '../types'

export const ElasticsearchBlock: BlockConfig<ElasticsearchResponse> = {
  type: 'elasticsearch',
  name: 'Elasticsearch',
  description: 'Execute Elasticsearch operations',
  longDescription:
    'Connect to and interact with Elasticsearch clusters. Perform search, index, update, delete, and other operations.',
  category: 'tools',
  bgColor: '#00BFB3',
  icon: ElasticsearchIcon,
  subBlocks: [
    {
      id: 'connection',
      title: 'Connection',
      type: 'tool-input',
      layout: 'full',
      placeholder: 'Configure Elasticsearch connection',
    },
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'Search', id: 'search' },
        { label: 'Index Document', id: 'index' },
        { label: 'Update Document', id: 'update' },
        { label: 'Delete Document', id: 'delete' },
        { label: 'Create Index', id: 'create_index' },
        { label: 'Delete Index', id: 'delete_index' },
        { label: 'Get Document', id: 'get' },
        { label: 'Bulk Index', id: 'bulk' },
      ],
      value: () => 'search',
    },
    {
      id: 'index',
      title: 'Index',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Enter index name',
      condition: {
        field: 'operation',
        value: ['search', 'index', 'update', 'delete', 'create_index', 'delete_index', 'get', 'bulk'],
      },
    },
    {
      id: 'id',
      title: 'Document ID',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Enter document ID',
      condition: {
        field: 'operation',
        value: ['index', 'update', 'delete', 'get'],
      },
    },
    {
      id: 'query',
      title: 'Query',
      type: 'code',
      layout: 'full',
      placeholder: 'Enter Elasticsearch query',
      condition: {
        field: 'operation',
        value: ['search'],
      },
    },
    {
      id: 'document',
      title: 'Document',
      type: 'code',
      layout: 'full',
      placeholder: 'Enter document to index/update',
      condition: {
        field: 'operation',
        value: ['index', 'update'],
      },
    },
    {
      id: 'mapping',
      title: 'Mapping',
      type: 'code',
      layout: 'full',
      placeholder: 'Enter index mapping',
      condition: {
        field: 'operation',
        value: ['create_index'],
      },
    },
    {
      id: 'documents',
      title: 'Documents',
      type: 'code',
      layout: 'full',
      placeholder: 'Enter documents for bulk indexing',
      condition: {
        field: 'operation',
        value: ['bulk'],
      },
    },
    {
      id: 'options',
      title: 'Options',
      type: 'code',
      layout: 'full',
      placeholder: 'Enter operation options',
    },
  ],
  tools: {
    access: ['elasticsearch'],
    config: {
      tool: () => 'elasticsearch',
      params: (params) => ({
        connection: params.connection,
        operation: params.operation,
        index: params.index,
        id: params.id,
        query: params.query ? JSON.parse(params.query) : undefined,
        document: params.document ? JSON.parse(params.document) : undefined,
        mapping: params.mapping ? JSON.parse(params.mapping) : undefined,
        documents: params.documents ? JSON.parse(params.documents) : undefined,
        options: params.options ? JSON.parse(params.options) : undefined,
      }),
    },
  },
  inputs: {
    connection: { type: 'json', required: true },
    operation: { type: 'string', required: true },
    index: { type: 'string', required: false },
    id: { type: 'string', required: false },
    query: { type: 'json', required: false },
    document: { type: 'json', required: false },
    mapping: { type: 'json', required: false },
    documents: { type: 'json', required: false },
    options: { type: 'json', required: false },
  },
  outputs: {
    response: {
      type: {
        result: 'string',
        metadata: 'string'
      }
    }
  },
} 