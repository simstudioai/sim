// sim/tools/salesforce/index.ts
import { salesforceQueryTool } from './query/query'
import { 
  salesforceCreateRecordsTool, 
  salesforceUpdateRecordsTool,
  salesforceDeleteRecordsTool,
  salesforceGetRecordTool 
} from './record/record'
import {
  salesforceCreateBulkJobTool,
  salesforceUploadBulkJobDataTool,
  salesforceCloseBulkJobTool,
  salesforceGetBulkJobStatusTool,
  salesforceGetBulkJobResultsTool
} from './bulkapi/bulkapi'

// Export all tools with consistent naming
export const salesforceQuery = salesforceQueryTool
export const salesforceCreateRecords = salesforceCreateRecordsTool
export const salesforceUpdateRecords = salesforceUpdateRecordsTool
export const salesforceDeleteRecords = salesforceDeleteRecordsTool
export const salesforceGetRecord = salesforceGetRecordTool
export const salesforceCreateBulkJob = salesforceCreateBulkJobTool
export const salesforceUploadBulkJobData = salesforceUploadBulkJobDataTool
export const salesforceCloseBulkJob = salesforceCloseBulkJobTool
export const salesforceGetBulkJobStatus = salesforceGetBulkJobStatusTool
export const salesforceGetBulkJobResults = salesforceGetBulkJobResultsTool