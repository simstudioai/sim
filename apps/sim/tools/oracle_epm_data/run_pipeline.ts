import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmDataRunPipelineParams,
  OracleEpmDataSubmissionResponse,
} from '@/tools/oracle_epm_data/types'
import {
  ORACLE_EPM_DATA_SUBMISSION_OUTPUTS,
  oracleEpmDataAuthParamFields,
  oracleEpmDataOAuth,
} from '@/tools/oracle_epm_data/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmDataRunPipelineTool: InternalToolConfig<
  OracleEpmDataRunPipelineParams,
  OracleEpmDataSubmissionResponse
> = {
  id: 'oracle_epm_data_run_pipeline',
  name: 'Oracle EPM Data Run Pipeline',
  description:
    'Submit an existing pipeline and return uninterpreted Oracle JSON, without assumed job-ID fields or polling.',
  version: '1.0.0',
  oauth: oracleEpmDataOAuth,
  params: {
    ...oracleEpmDataAuthParamFields,
    pipelineCode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Immutable pipeline code, not display name; 3–30 alphanumeric characters',
    },
    variables: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Configured pipeline variable names and string values; omitted variables retain tenant defaults',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPM_DATA_SUBMISSION_OUTPUTS,
}
