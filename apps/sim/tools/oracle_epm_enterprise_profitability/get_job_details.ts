import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpcmGetJobDetailsParams,
  OracleEpcmResponse,
} from '@/tools/oracle_epm_enterprise_profitability/types'
import { ORACLE_EPCM_GET_JOB_DETAILS_OUTPUTS } from '@/tools/oracle_epm_enterprise_profitability/types'
import {
  oracleEpcmAuthParams,
  oracleEpcmOAuth,
} from '@/tools/oracle_epm_enterprise_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpcmGetJobDetailsTool: InternalToolConfig<
  OracleEpcmGetJobDetailsParams,
  OracleEpcmResponse
> = {
  id: 'oracle_epm_enterprise_profitability_get_job_details',
  name: 'Oracle EPCM Get Job Details',
  description:
    'Read one page of data/metadata import/export diagnostics, not EPCM calculation traces.',
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
    jobType: {
      type: 'string',
      required: true,
      description:
        'Diagnostic job family; must match the submitted job. Allowed values: IMPORT_DATA, EXPORT_DATA, IMPORT_METADATA, EXPORT_METADATA.',
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
  outputs: ORACLE_EPCM_GET_JOB_DETAILS_OUTPUTS,
}
