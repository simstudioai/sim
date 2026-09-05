import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmDataGetPovStatusParams,
  OracleEpmDataResponse,
} from '@/tools/oracle_epm_data/types'
import {
  ORACLE_EPM_DATA_POV_OUTPUTS,
  oracleEpmDataAuthParamFields,
  oracleEpmDataOAuth,
} from '@/tools/oracle_epm_data/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmDataGetPovStatusTool: InternalToolConfig<
  OracleEpmDataGetPovStatusParams,
  OracleEpmDataResponse
> = {
  id: 'oracle_epm_data_get_pov_status',
  name: 'Oracle EPM Data Get POV Status',
  description: 'Read location/application lock status for a Data Integration period and category.',
  version: '1.0.0',
  oauth: oracleEpmDataOAuth,
  params: {
    ...oracleEpmDataAuthParamFields,
    period: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Data Integration POV period',
    },
    category: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Configured POV category, such as Actual',
    },
    application: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Application whose POV status should be read',
    },
    locationName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional location filter',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPM_DATA_POV_OUTPUTS,
}
