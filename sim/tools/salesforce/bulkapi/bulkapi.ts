import { ToolConfig } from '../../types'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('SalesforceBulkAPITools')

// Function to create a bulk job
async function createBulkJob(
  accessToken: string,
  object: string,
  operation: string,
  contentType: string = 'CSV',
  lineEnding: string = 'LF'
) {
  try {
    const response = await fetch(
      'https://login.salesforce.com/services/data/v59.0/jobs/ingest',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          object,
          contentType,
          operation,
          lineEnding,
        }),
      }
    )

    if (!response.ok) {
      const error = await response.json()
      throw new Error(`Failed to create bulk job: ${JSON.stringify(error)}`)
    }

    return await response.json()
  } catch (error) {
    logger.error('Error creating bulk job:', error)
    throw error
  }
}

// Function to upload data to a bulk job
async function uploadBulkJobData(accessToken: string, jobId: string, data: string) {
  try {
    const response = await fetch(
      `https://login.salesforce.com/services/data/v59.0/jobs/ingest/${jobId}/batches`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'text/csv',
        },
        body: data,
      }
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to upload bulk job data: ${error}`)
    }

    return { success: true }
  } catch (error) {
    logger.error('Error uploading bulk job data:', error)
    throw error
  }
}

// Function to close a bulk job
async function closeBulkJob(accessToken: string, jobId: string) {
  try {
    const response = await fetch(
      `https://login.salesforce.com/services/data/v59.0/jobs/ingest/${jobId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          state: 'UploadComplete',
        }),
      }
    )

    if (!response.ok) {
      const error = await response.json()
      throw new Error(`Failed to close bulk job: ${JSON.stringify(error)}`)
    }

    return await response.json()
  } catch (error) {
    logger.error('Error closing bulk job:', error)
    throw error
  }
}

// Function to get bulk job status
async function getBulkJobStatus(accessToken: string, jobId: string) {
  try {
    const response = await fetch(
      `https://login.salesforce.com/services/data/v59.0/jobs/ingest/${jobId}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    if (!response.ok) {
      const error = await response.json()
      throw new Error(`Failed to get bulk job status: ${JSON.stringify(error)}`)
    }

    return await response.json()
  } catch (error) {
    logger.error('Error getting bulk job status:', error)
    throw error
  }
}

// Function to get bulk job results
async function getBulkJobResults(accessToken: string, jobId: string) {
  try {
    const response = await fetch(
      `https://login.salesforce.com/services/data/v59.0/jobs/ingest/${jobId}/successfulResults`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    if (!response.ok) {
      // Try to get failed results instead
      const failedResponse = await fetch(
        `https://login.salesforce.com/services/data/v59.0/jobs/ingest/${jobId}/failedResults`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      )
      
      if (!failedResponse.ok) {
        const error = await failedResponse.text()
        throw new Error(`Failed to get bulk job results: ${error}`)
      }
      
      return {
        success: false,
        results: await failedResponse.text()
      }
    }

    return {
      success: true,
      results: await response.text()
    }
  } catch (error) {
    logger.error('Error getting bulk job results:', error)
    throw error
  }
}

// Create Bulk Job Tool
export const salesforceCreateBulkJobTool: ToolConfig = {
  id: 'salesforce_create_bulk_job',
  name: 'Salesforce Create Bulk Job',
  description: 'Create a new Bulk API job in Salesforce',
  version: '1.0.0',
  
  params: {
    object: {
      type: 'string',
      required: true,
      description: 'Salesforce object type (e.g., Account, Contact)',
    },
    bulkOperation: {
      type: 'string',
      required: true,
      description: 'Bulk operation type (insert, update, upsert, delete)',
    },
    contentType: {
      type: 'string',
      required: false,
      default: 'CSV',
      description: 'Content type for the bulk job (CSV, JSON, XML)',
    },
    lineEnding: {
      type: 'string',
      required: false,
      default: 'LF',
      description: 'Line ending for CSV files (LF, CRLF)',
    },
    accessToken: {
      type: 'string',
      required: true,
      description: 'Salesforce access token',
    }
  },
  request: {
    url: 'https://login.salesforce.com/services/data/v59.0/jobs/ingest',
    method: 'POST',
    headers: (params) => ({
      'Authorization': `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json'
    }),
    body: (params) => ({
      object: params.object,
      contentType: params.contentType,
      operation: params.bulkOperation,
      lineEnding: params.lineEnding
    })
  },
  
  directExecution: async (params) => {
    try {
      logger.info(`Creating Salesforce bulk job`)
      
      const { object, bulkOperation, contentType, lineEnding, accessToken } = params
      
      const result = await createBulkJob(
        accessToken,
        object,
        bulkOperation,
        contentType,
        lineEnding
      )
      
      return {
        success: true,
        output: {
          id: result.id,
          jobType: result.object,
          operation: result.operation,
          state: result.state
        }
      }
    } catch (error) {
      logger.error(`Error creating bulk job:`, error)
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        output: {
          errors: [error instanceof Error ? error.message : 'Unknown error occurred']
        }
      }
    }
  }
}

// Upload Bulk Job Data Tool
export const salesforceUploadBulkJobDataTool: ToolConfig = {
  id: 'salesforce_upload_bulk_job_data',
  name: 'Salesforce Upload Bulk Job Data',
  description: 'Upload data to a Salesforce Bulk API job',
  version: '1.0.0',
  
  params: {
    jobId: {
      type: 'string',
      required: true,
      description: 'ID of the bulk job',
    },
    data: {
      type: 'string',
      required: true,
      description: 'CSV data to upload',
    },
    accessToken: {
      type: 'string',
      required: true,
      description: 'Salesforce access token',
    }
  },
  request: {
    url: (params) => `https://login.salesforce.com/services/data/v59.0/jobs/ingest/${params.jobId}/batches`,
    method: 'PUT',
    headers: (params) => ({
      'Authorization': `Bearer ${params.accessToken}`,
      'Content-Type': 'text/csv'
    }),
    body: (params) => params.data
  },
  
  directExecution: async (params) => {
    try {
      logger.info(`Uploading data to Salesforce bulk job`)
      
      const { jobId, data, accessToken } = params
      
      const result = await uploadBulkJobData(accessToken, jobId, data)
      
      return {
        success: true,
        output: {
          success: result.success
        }
      }
    } catch (error) {
      logger.error(`Error uploading bulk job data:`, error)
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        output: {
          success: false,
          errors: [error instanceof Error ? error.message : 'Unknown error occurred']
        }
      }
    }
  }
}

// Close Bulk Job Tool
export const salesforceCloseBulkJobTool: ToolConfig = {
  id: 'salesforce_close_bulk_job',
  name: 'Salesforce Close Bulk Job',
  description: 'Close a Salesforce Bulk API job to begin processing',
  version: '1.0.0',
  
  params: {
    jobId: {
      type: 'string',
      required: true,
      description: 'ID of the bulk job',
    },
    accessToken: {
      type: 'string',
      required: true,
      description: 'Salesforce access token',
    }
  },
  request: {
    url: (params) => `https://login.salesforce.com/services/data/v59.0/jobs/ingest/${params.jobId}`,
    method: 'PATCH',
    headers: (params) => ({
      'Authorization': `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json'
    }),
    body: () => ({ state: 'UploadComplete' })
  },
  
  directExecution: async (params) => {
    try {
      logger.info(`Closing Salesforce bulk job`)
      
      const { jobId, accessToken } = params
      
      const result = await closeBulkJob(accessToken, jobId)
      
      return {
        success: true,
        output: {
          id: result.id,
          state: result.state
        }
      }
    } catch (error) {
      logger.error(`Error closing bulk job:`, error)
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        output: {
          errors: [error instanceof Error ? error.message : 'Unknown error occurred']
        }
      }
    }
  }
}

// Get Bulk Job Status Tool
export const salesforceGetBulkJobStatusTool: ToolConfig = {
  id: 'salesforce_get_bulk_job_status',
  name: 'Salesforce Get Bulk Job Status',
  description: 'Get the status of a Salesforce Bulk API job',
  version: '1.0.0',
  
  params: {
    jobId: {
      type: 'string',
      required: true,
      description: 'ID of the bulk job',
    },
    accessToken: {
      type: 'string',
      required: true,
      description: 'Salesforce access token',
    }
  },
  request: {
    url: (params) => `https://login.salesforce.com/services/data/v59.0/jobs/ingest/${params.jobId}`,
    method: 'GET',
    headers: (params) => ({
      'Authorization': `Bearer ${params.accessToken}`
    })
  },
  
  directExecution: async (params) => {
    try {
      logger.info(`Getting Salesforce bulk job status`)
      
      const { jobId, accessToken } = params
      
      const result = await getBulkJobStatus(accessToken, jobId)
      
      return {
        success: true,
        output: {
          id: result.id,
          object: result.object,
          operation: result.operation,
          state: result.state,
          createdDate: result.createdDate,
          systemModstamp: result.systemModstamp,
          numberRecordsProcessed: result.numberRecordsProcessed,
          numberRecordsFailed: result.numberRecordsFailed,
          totalProcessingTime: result.totalProcessingTime
        }
      }
    } catch (error) {
      logger.error(`Error getting bulk job status:`, error)
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        output: {
          errors: [error instanceof Error ? error.message : 'Unknown error occurred']
        }
      }
    }
  }
}

// Get Bulk Job Results Tool
export const salesforceGetBulkJobResultsTool: ToolConfig = {
  id: 'salesforce_get_bulk_job_results',
  name: 'Salesforce Get Bulk Job Results',
  description: 'Get the results of a completed Salesforce Bulk API job',
  version: '1.0.0',
  
  params: {
    jobId: {
      type: 'string',
      required: true,
      description: 'ID of the bulk job',
    },
    accessToken: {
      type: 'string',
      required: true,
      description: 'Salesforce access token',
    }
  },
  request: {
    url: (params) => `https://login.salesforce.com/services/data/v59.0/jobs/ingest/${params.jobId}/successfulResults`,
    method: 'GET',
    headers: (params) => ({
      'Authorization': `Bearer ${params.accessToken}`
    })
  },
  
  directExecution: async (params) => {
    try {
      logger.info(`Getting Salesforce bulk job results`)
      
      const { jobId, accessToken } = params
      
      const result = await getBulkJobResults(accessToken, jobId)
      
      return {
        success: true,
        output: {
          success: result.success,
          results: result.results
        }
      }
    } catch (error) {
      logger.error(`Error getting bulk job results:`, error)
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        output: {
          success: false,
          errors: [error instanceof Error ? error.message : 'Unknown error occurred']
        }
      }
    }
  }
}