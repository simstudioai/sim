import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningGetJobDetailsParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/retrieve_job_status_details.html */
export const oracleEpmPlanningGetJobDetailsTool: InternalToolConfig<
  OracleEpmPlanningGetJobDetailsParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_get_job_details',
  name: 'Oracle EPM Planning Get Job Details',
  description:
    'Read one page of data or metadata import/export diagnostics, including processed and rejected record counts.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    application: { ...oracleEpmPlanningParamFields.application, required: true },
    jobId: { ...oracleEpmPlanningParamFields.jobId, required: true },
    offset: { ...oracleEpmPlanningParamFields.offset, required: false },
    limit: { ...oracleEpmPlanningParamFields.limit, required: false },
    messageType: { ...oracleEpmPlanningParamFields.messageType, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    jobDetails: {
      type: 'array',
      description: 'One page of import/export diagnostics',
      items: {
        type: 'object',
        properties: {
          recordsRead: {
            type: 'number',
            description: 'recordsRead',
            optional: true,
          },
          recordsRejected: {
            type: 'number',
            description: 'recordsRejected',
            optional: true,
          },
          recordsProcessed: {
            type: 'number',
            description: 'recordsProcessed',
            optional: true,
          },
          dimensionName: {
            type: 'string',
            description: 'Dimension name',
            optional: true,
          },
          loadType: {
            type: 'string',
            description: 'Load type',
            optional: true,
          },
        },
      },
    },
  },
}
