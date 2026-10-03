import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmDataGetPipelineDetailsParams,
  OracleEpmDataResponse,
} from '@/tools/oracle_epm_data/types'
import {
  ORACLE_EPM_DATA_PIPELINE_OUTPUTS,
  oracleEpmDataAuthParamFields,
  oracleEpmDataOAuth,
} from '@/tools/oracle_epm_data/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmDataGetPipelineDetailsTool: InternalToolConfig<
  OracleEpmDataGetPipelineDetailsParams,
  OracleEpmDataResponse
> = {
  id: 'oracle_epm_data_get_pipeline_details',
  name: 'Oracle EPM Data Get Pipeline Details',
  description:
    "Read an existing pipeline's definition, variables, stages, jobs, and latest execution metadata.",
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
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPM_DATA_PIPELINE_OUTPUTS,
}
