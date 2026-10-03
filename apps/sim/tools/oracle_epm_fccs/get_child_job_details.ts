import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsGetChildJobDetailsParams, FccsResponse } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/retrieve_child_job_status_details.html */
export const oracleEpmFccsGetChildJobDetailsTool: InternalToolConfig<
  FccsGetChildJobDetailsParams,
  FccsResponse
> = {
  id: 'oracle_epm_fccs_get_child_job_details',
  name: 'Oracle EPM FCCS Get Child Job Details',
  description: 'Read one page of child-job messages for a metadata import/export execution.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
    jobId: fccsParamFields.jobId,
    childJobId: fccsParamFields.childJobId,
    childJobType: fccsParamFields.childJobType,
    offset: { ...fccsParamFields.offset, required: false },
    limit: { ...fccsParamFields.limit, required: false },
    messageType: { ...fccsParamFields.messageType, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    items: {
      type: 'array',
      description: 'One page of metadata child-job messages',
      items: {
        type: 'object',
        properties: {
          msgType: {
            type: 'string',
            description: 'Message type',
          },
          msgCategory: {
            type: 'string',
            description: 'Message category',
          },
          msgText: {
            type: 'string',
            description: 'Message text',
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
