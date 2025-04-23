import { ToolConfig } from '../../types'
import { createLogger } from '@/lib/logs/console-logger'
import { executeSOQLQuery, executeSOQLQueryWithMoreRecords } from './tools'

const logger = createLogger('SalesforceQueryTool')

export const salesforceQueryTool: ToolConfig = {
  id: 'salesforce_query',
  name: 'Salesforce Query',
  description: 'Execute SOQL queries against Salesforce',
  version: '1.0.0',
  params: {
    query: {
      type: 'string',
      required: true,
      description: 'SOQL query to execute',
    },
    fetchAll: {
      type: 'boolean',
      required: false,
      default: false,
      description: 'Whether to fetch all records or just the first batch',
    },
    accessToken: {
      type: 'string',
      required: true,
      description: 'Salesforce access token',
    },
    instanceUrl: {
      type: 'string',
      required: false,
      description: 'Salesforce instance URL',
    }
  },
  request: {
    url: (params) => {
      const instanceUrl = params.instanceUrl || 'https://login.salesforce.com'
      return `${instanceUrl}/services/data/v59.0/query?q=${encodeURIComponent(params.query)}`
    },
    method: 'GET',
    headers: (params) => ({
      'Authorization': `Bearer ${params.accessToken}`
    })
  },
  directExecution: async (params) => {
    try {
      logger.info(`Executing SOQL query`)
      
      const { query, fetchAll, accessToken, instanceUrl } = params
      
      if (fetchAll) {
        const result = await executeSOQLQueryWithMoreRecords(accessToken, instanceUrl, { query })
        return {
          success: true,
          output: {
            done: result.done,
            totalSize: result.totalSize,
            records: result.records
          }
        }
      } else {
        const result = await executeSOQLQuery(accessToken, instanceUrl, { query })
        return {
          success: true,
          output: {
            done: result.done,
            totalSize: result.totalSize,
            records: result.records,
            nextRecordsUrl: result.nextRecordsUrl
          }
        }
      }
    } catch (error) {
      logger.error(`Error executing SOQL query:`, error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        output: {
          done: false,
          totalSize: 0,
          records: []
        }
      }
    }
  }
}