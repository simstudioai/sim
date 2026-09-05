import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpcmGetChildJobDetailsParams,
  OracleEpcmResponse,
} from '@/tools/oracle_epm_enterprise_profitability/types'
import { ORACLE_EPCM_GET_CHILD_JOB_DETAILS_OUTPUTS } from '@/tools/oracle_epm_enterprise_profitability/types'
import {
  oracleEpcmAuthParams,
  oracleEpcmOAuth,
} from '@/tools/oracle_epm_enterprise_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpcmGetChildJobDetailsTool: InternalToolConfig<
  OracleEpcmGetChildJobDetailsParams,
  OracleEpcmResponse
> = {
  id: 'oracle_epm_enterprise_profitability_get_child_job_details',
  name: 'Oracle EPCM Get Child Job Details',
  description: 'Read one page of child-job diagnostic messages for a metadata import or export.',
  version: '1.0.0',
  oauth: oracleEpcmOAuth,
  params: {
    ...oracleEpcmAuthParams,

    applicationName: {
      type: 'string',
      required: true,
      description: 'Exact EPCM application name',
      visibility: 'user-or-llm',
    },
    jobId: {
      type: 'string',
      required: true,
      description: 'Oracle job ID returned by a submission',
      visibility: 'user-or-llm',
    },
    childJobId: {
      type: 'string',
      required: true,
      description: 'Validated child job ID returned by Get Job Details',
      visibility: 'user-or-llm',
    },
    jobType: {
      type: 'string',
      required: true,
      description:
        'Metadata diagnostic job family. Allowed values: IMPORT_METADATA, EXPORT_METADATA.',
      visibility: 'user-or-llm',
    },
    offset: {
      type: 'number',
      required: false,
      description: 'Zero-based diagnostic offset',
      default: 0,
      visibility: 'user-or-llm',
    },
    limit: {
      type: 'number',
      required: false,
      description: 'One diagnostic page, 1–1000 items',
      default: 25,
      visibility: 'user-or-llm',
    },
    messageType: {
      type: 'string',
      required: false,
      description: 'Optional message filter: ERROR, WARNING, or INFO',
      visibility: 'user-or-llm',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPCM_GET_CHILD_JOB_DETAILS_OUTPUTS,
}
