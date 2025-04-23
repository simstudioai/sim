import { ToolConfig } from '../../types'
import { createLogger } from '@/lib/logs/console-logger'
import { 
  createRecords, 
  updateRecords, 
  deleteRecords, 
  getRecordById 
} from './tools'

const logger = createLogger('SalesforceRecordTools')

// Create Records Tool
export const salesforceCreateRecordsTool: ToolConfig = {
  id: 'salesforce_create_records',
  name: 'Salesforce Create Records',
  description: 'Create new records in Salesforce',
  version: '1.0.0',
  params: {
    objectType: {
      type: 'string',
      required: true,
      description: 'Salesforce object type (e.g., Account, Contact)',
    },
    records: {
      type: 'json',
      required: true,
      description: 'Array of records to create',
    },
    accessToken: {
      type: 'string',
      required: true,
      description: 'Salesforce access token',
    },
    instanceUrl: {
      type: 'string',
      required: true,
      description: 'Salesforce instance URL',
    }
  },
  request: {
    url: (params) => `https://login.salesforce.com/services/data/v59.0/composite/sobjects/${params.objectType}`,
    method: 'POST',
    headers: (params) => ({
      'Authorization': `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json'
    }),
    body: (params) => ({ records: params.records })
  },
  directExecution: async (params) => {
    try {
      logger.info(`Creating Salesforce records`)
      const { objectType, records, accessToken, instanceUrl } = params
      if (!Array.isArray(records)) {
        return {
          success: false,
          error: 'Records must be an array',
          output: { success: false, errors: ['Records must be an array'] }
        }
      }
      const results = await createRecords(accessToken, instanceUrl, objectType, records)
      return { success: true, output: { success: true, records: results } }
    } catch (error) {
      logger.error(`Error creating records:`, error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        output: { success: false, errors: [error instanceof Error ? error.message : 'Unknown error occurred'] }
      }
    }
  }
}

// Update Records Tool
export const salesforceUpdateRecordsTool: ToolConfig = {
  id: 'salesforce_update_records',
  name: 'Salesforce Update Records',
  description: 'Update existing records in Salesforce',
  version: '1.0.0',
  params: {
    objectType: {
      type: 'string',
      required: true,
      description: 'Salesforce object type (e.g., Account, Contact)',
    },
    records: {
      type: 'json',
      required: true,
      description: 'Array of records to update (must include Id field)',
    },
    accessToken: {
      type: 'string',
      required: true,
      description: 'Salesforce access token',
    },
    instanceUrl: {
      type: 'string',
      required: true,
      description: 'Salesforce instance URL',
    }
  },
  request: {
    url: (params) => `https://login.salesforce.com/services/data/v59.0/composite/sobjects/${params.objectType}`,
    method: 'PATCH',
    headers: (params) => ({
      'Authorization': `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json'
    }),
    body: (params) => ({ records: params.records })
  },
  directExecution: async (params) => {
    try {
      logger.info(`Updating Salesforce records`)
      const { objectType, records, accessToken, instanceUrl } = params
      if (!Array.isArray(records)) {
        return {
          success: false,
          error: 'Records must be an array',
          output: { success: false, errors: ['Records must be an array'] }
        }
      }
      const results = await updateRecords(accessToken, instanceUrl, objectType, records)
      return { success: true, output: { success: true, records: results } }
    } catch (error) {
      logger.error(`Error updating records:`, error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        output: { success: false, errors: [error instanceof Error ? error.message : 'Unknown error occurred'] }
      }
    }
  }
}

// Delete Records Tool
export const salesforceDeleteRecordsTool: ToolConfig = {
  id: 'salesforce_delete_records',
  name: 'Salesforce Delete Records',
  description: 'Delete records from Salesforce',
  version: '1.0.0',
  params: {
    objectType: {
      type: 'string',
      required: true,
      description: 'Salesforce object type (e.g., Account, Contact)',
    },
    recordIds: {
      type: 'json',
      required: true,
      description: 'Array of record IDs to delete',
    },
    accessToken: {
      type: 'string',
      required: true,
      description: 'Salesforce access token',
    },
    instanceUrl: {
      type: 'string',
      required: true,
      description: 'Salesforce instance URL',
    }
  },
  request: {
    url: (params) => `https://login.salesforce.com/services/data/v59.0/composite/sobjects/${params.objectType}`,
    method: 'DELETE',
    headers: (params) => ({
      'Authorization': `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json'
    }),
    body: (params) => ({ ids: params.recordIds })
  },
  directExecution: async (params) => {
    try {
      logger.info(`Deleting Salesforce records`)
      const { objectType, recordIds, accessToken, instanceUrl } = params
      if (!Array.isArray(recordIds)) {
        return {
          success: false,
          error: 'Record IDs must be an array',
          output: { success: false, errors: ['Record IDs must be an array'] }
        }
      }
      const results = await deleteRecords(accessToken, instanceUrl, objectType, recordIds)
      return { success: true, output: { success: true, records: results } }
    } catch (error) {
      logger.error(`Error deleting records:`, error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        output: { success: false, errors: [error instanceof Error ? error.message : 'Unknown error occurred'] }
      }
    }
  }
}

// Get Record Tool
export const salesforceGetRecordTool: ToolConfig = {
  id: 'salesforce_get_record',
  name: 'Salesforce Get Record',
  description: 'Retrieve a single record from Salesforce by ID',
  version: '1.0.0',
  params: {
    objectType: {
      type: 'string',
      required: true,
      description: 'Salesforce object type (e.g., Account, Contact)',
    },
    recordId: {
      type: 'string',
      required: true,
      description: 'ID of the record to retrieve',
    },
    accessToken: {
      type: 'string',
      required: true,
      description: 'Salesforce access token',
    },
    instanceUrl: {
      type: 'string',
      required: true,
      description: 'Salesforce instance URL',
    }
  },
  request: {
    url: (params) => `https://login.salesforce.com/services/data/v59.0/sobjects/${params.objectType}/${params.recordId}`,
    method: 'GET',
    headers: (params) => ({
      'Authorization': `Bearer ${params.accessToken}`
    })
  },
  directExecution: async (params) => {
    try {
      logger.info(`Getting Salesforce record`)
      const { objectType, recordId, accessToken, instanceUrl } = params
      const record = await getRecordById(accessToken, instanceUrl, objectType, recordId)
      return { success: true, output: { record } }
    } catch (error) {
      logger.error(`Error getting record:`, error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        output: { errors: [error instanceof Error ? error.message : 'Unknown error occurred'] }
      }
    }
  }
}