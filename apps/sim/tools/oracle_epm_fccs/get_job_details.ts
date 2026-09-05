import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsGetJobDetailsParams, FccsResponse } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/retrieve_job_status_details.html */
export const oracleEpmFccsGetJobDetailsTool: InternalToolConfig<
  FccsGetJobDetailsParams,
  FccsResponse
> = {
  id: 'oracle_epm_fccs_get_job_details',
  name: 'Oracle EPM FCCS Get Job Details',
  description:
    'Read one page of diagnostics for a data or metadata import/export job; expose validated child-job IDs.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
    jobId: fccsParamFields.jobId,
    detailJobType: fccsParamFields.detailJobType,
    offset: { ...fccsParamFields.offset, required: false },
    limit: { ...fccsParamFields.limit, required: false },
    messageType: { ...fccsParamFields.messageType, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    items: {
      type: 'array',
      description: 'One page of supported job diagnostics',
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
            description: 'Dimension',
            optional: true,
          },
          loadType: {
            type: 'string',
            description: 'Load type',
            optional: true,
          },
          childJobId: {
            type: 'string',
            description: 'Child ID from a validated Oracle child-job-details link',
            optional: true,
          },
        },
      },
    },
    hasMore: {
      type: 'boolean',
      description: 'Oracle returned a validated next-page link',
    },
    nextOffset: {
      type: 'number',
      description: 'Next page offset from that link',
      optional: true,
    },
  },
}
