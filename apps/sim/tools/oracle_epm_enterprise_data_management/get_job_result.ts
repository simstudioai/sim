import type {
  OracleEpmEdmGetJobResultParams,
  OracleEpmEdmGetJobResultResponse,
} from '@/tools/oracle_epm_enterprise_data_management/types'
import {
  edmAuthParams,
  edmOperationInput,
  edmOutputs,
  edmParam,
} from '@/tools/oracle_epm_enterprise_data_management/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmEdmGetJobResultTool: InternalToolConfig<
  OracleEpmEdmGetJobResultParams,
  OracleEpmEdmGetJobResultResponse
> = {
  id: 'oracle_epm_edm_get_job_result',
  name: 'Oracle EDM Get Job Result',
  description:
    'Get a documented job-result envelope with an opaque result, or download its result file.',
  version: '1.0.0',
  oauth: {
    required: true,
    provider: 'oracle-epm-enterprise-data-management',
    credentialKind: 'service-account',
    authoritativeParams: ['instanceUrl'],
  },
  params: {
    ...edmAuthParams,
    jobRunId: edmParam('string', true, 'Oracle job UUID'),
    downloadFile: edmParam(
      'boolean',
      false,
      'Download a completed job file alongside its opaque result; supply the original staging file name when no file link is advertised (default false)'
    ),
    fileName: edmParam(
      'string',
      false,
      'Single Oracle staging, attachment, or output file name; no directory path'
    ),
  },
  operation: { input: (params) => edmOperationInput('oracle_epm_edm_get_job_result', params) },
  outputs: {
    job: { ...edmOutputs.job, optional: true },
    result: edmOutputs.result,
    file: edmOutputs.file,
  },
}
