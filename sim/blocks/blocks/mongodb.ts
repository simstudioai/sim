import { MongoDBIcon } from '@/components/icons'
import { MongoDBResponse } from '@/tools/databases/mongodb/types'
import { BlockConfig } from '../types'

export const MongoDBBlock: BlockConfig<MongoDBResponse> = {
  type: 'mongodb',
  name: 'MongoDB',
  description: 'Execute MongoDB operations',
  longDescription:
    'Connect to and interact with MongoDB databases. Perform find, insert, update, delete, and aggregate operations on your collections.',
  category: 'tools',
  bgColor: '#4CAF50',
  icon: MongoDBIcon,
  subBlocks: [
    {
      id: 'host',
      title: 'Host',
      type: 'short-input',
      layout: 'half',
      placeholder: 'mongodb',
      value: () => 'mongodb',
    },
    {
      id: 'port',
      title: 'Port',
      type: 'short-input',
      layout: 'half',
      placeholder: '27017',
      value: () => '27017',
    },
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      layout: 'half',
      placeholder: 'root',
      value: () => 'root',
    },
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Enter password',
      password: true,
      value: () => 'root',
    },
    {
      id: 'database',
      title: 'Database',
      type: 'short-input',
      layout: 'half',
      placeholder: 'simstudio',
      value: () => 'simstudio',
    },
    {
      id: 'ssl',
      title: 'Use SSL',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
    },
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'Find Documents', id: 'find' },
        { label: 'Insert Document', id: 'insert' },
        { label: 'Update Document', id: 'update' },
        { label: 'Delete Document', id: 'delete' },
        { label: 'Aggregate', id: 'aggregate' },
      ],
      value: () => 'find',
    },
    {
      id: 'collection',
      title: 'Collection',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Enter collection name',
    },
    {
      id: 'query',
      title: 'Query',
      type: 'code',
      layout: 'full',
      placeholder: 'Enter MongoDB query filter',
      condition: {
        field: 'operation',
        value: ['find', 'update', 'delete'],
      },
    },
    {
      id: 'projection',
      title: 'Projection',
      type: 'code',
      layout: 'full',
      placeholder: 'Enter projection fields',
      condition: {
        field: 'operation',
        value: ['find'],
      },
    },
    {
      id: 'document',
      title: 'Document',
      type: 'code',
      layout: 'full',
      placeholder: 'Enter document to insert',
      condition: {
        field: 'operation',
        value: ['insert'],
      },
    },
    {
      id: 'update',
      title: 'Update',
      type: 'code',
      layout: 'full',
      placeholder: 'Enter update operation',
      condition: {
        field: 'operation',
        value: ['update'],
      },
    },
    {
      id: 'pipeline',
      title: 'Pipeline',
      type: 'code',
      layout: 'full',
      placeholder: 'Enter aggregation pipeline',
      condition: {
        field: 'operation',
        value: ['aggregate'],
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
    access: ['mongodb'],
    config: {
      tool: () => 'mongodb',
      params: (params) => {
        const connection = {
          host: params.host || 'mongodb',
          port: parseInt(params.port || '27017'),
          username: params.username || 'root',
          password: params.password || 'root',
          database: params.database || 'simstudio',
          ssl: params.ssl === 'true'
        }

        return {
          connection,
          operation: params.operation,
          collection: params.collection,
          query: params.query ? JSON.parse(params.query) : undefined,
          projection: params.projection ? JSON.parse(params.projection) : undefined,
          document: params.document ? JSON.parse(params.document) : undefined,
          update: params.update ? JSON.parse(params.update) : undefined,
          pipeline: params.pipeline ? JSON.parse(params.pipeline) : undefined,
          options: params.options ? JSON.parse(params.options) : undefined
        }
      },
    },
  },
  inputs: {
    host: { type: 'string', required: false },
    port: { type: 'string', required: false },
    username: { type: 'string', required: false },
    password: { type: 'string', required: false },
    database: { type: 'string', required: false },
    ssl: { type: 'string', required: false },
    operation: { type: 'string', required: true },
    collection: { type: 'string', required: true },
    query: { type: 'json', required: false },
    projection: { type: 'json', required: false },
    document: { type: 'json', required: false },
    update: { type: 'json', required: false },
    pipeline: { type: 'json', required: false },
    options: { type: 'json', required: false },
  },
  outputs: {
    response: {
      type: {
        result: 'string',
        affectedCount: 'string',
        metadata: 'string'
      }
    }
  },
} 