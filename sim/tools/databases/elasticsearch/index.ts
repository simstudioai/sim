import { ToolConfig } from '../../types'
import { ElasticsearchResponse } from './types'

const toolConfig: ToolConfig<any, ElasticsearchResponse> = {
  id: 'elasticsearch',
  name: 'Elasticsearch',
  description: 'Execute Elasticsearch operations on your cluster',
  version: '1.0.0',
  params: {
    connection: {
      type: 'json',
      required: true,
      description: 'Elasticsearch connection configuration'
    },
    operation: {
      type: 'string',
      required: true,
      description: 'Elasticsearch operation to perform'
    },
    index: {
      type: 'string',
      required: true,
      description: 'Index name for the operation'
    },
    id: {
      type: 'string',
      required: false,
      description: 'Document ID for get/update/delete operations'
    },
    query: {
      type: 'json',
      required: false,
      description: 'Query for search operations'
    },
    document: {
      type: 'json',
      required: false,
      description: 'Document for index/update operations'
    },
    options: {
      type: 'json',
      required: false,
      description: 'Additional options for the operation'
    }
  },
  request: {
    url: 'http://localhost:3000/api/elasticsearch',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json'
    }),
    body: (params) => params
  },
  directExecution: async (params) => {
    const startTime = Date.now()
    
    try {
      const response = await fetch('http://localhost:3000/api/elasticsearch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(params)
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const result = await response.json()

      return {
        success: true,
        output: {
          result: JSON.stringify(result.data || null),
          metadata: JSON.stringify({
            operation: params.operation,
            index: params.index,
            executionTime: Date.now() - startTime
          })
        }
      }
    } catch (error) {
      return {
        success: false,
        output: {
          result: 'null',
          metadata: JSON.stringify({
            operation: params.operation,
            index: params.index,
            executionTime: Date.now() - startTime
          })
        },
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  }
}

export default toolConfig 