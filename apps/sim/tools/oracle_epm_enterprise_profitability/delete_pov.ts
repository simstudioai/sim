import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpcmDeletePovParams,
  OracleEpcmResponse,
} from '@/tools/oracle_epm_enterprise_profitability/types'
import { ORACLE_EPCM_CALCULATE_MODEL_OUTPUTS } from '@/tools/oracle_epm_enterprise_profitability/types'
import {
  oracleEpcmAuthParams,
  oracleEpcmOAuth,
} from '@/tools/oracle_epm_enterprise_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpcmDeletePovTool: InternalToolConfig<
  OracleEpcmDeletePovParams,
  OracleEpcmResponse
> = {
  id: 'oracle_epm_enterprise_profitability_delete_pov',
  name: 'Oracle EPCM Delete POV',
  description:
    'Delete a specified POV and its data from the calculation cube. This is destructive.',
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
    jobName: {
      type: 'string',
      required: true,
      description: 'Calculation/report/POV job label; an existing saved job is not required',
      visibility: 'user-or-llm',
    },
    povDelimiter: {
      type: 'string',
      required: false,
      description: 'Explicit single-character POV delimiter: _, #, ~, %, ;, :, or -',
      default: ':',
      visibility: 'user-or-llm',
    },
    povName: {
      type: 'string',
      required: true,
      description:
        'POV members joined with the delimiter; calculations also accept comma-separated POVs',
      visibility: 'user-or-llm',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPCM_CALCULATE_MODEL_OUTPUTS,
}
