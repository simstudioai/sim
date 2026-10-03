import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpcmClearPovParams,
  OracleEpcmResponse,
} from '@/tools/oracle_epm_enterprise_profitability/types'
import { ORACLE_EPCM_CALCULATE_MODEL_OUTPUTS } from '@/tools/oracle_epm_enterprise_profitability/types'
import {
  oracleEpcmAuthParams,
  oracleEpcmOAuth,
} from '@/tools/oracle_epm_enterprise_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpcmClearPovTool: InternalToolConfig<
  OracleEpcmClearPovParams,
  OracleEpcmResponse
> = {
  id: 'oracle_epm_enterprise_profitability_clear_pov',
  name: 'Oracle EPCM Clear POV Data',
  description:
    'Clear explicitly selected input, allocated, or adjustment data in a specified POV and cube. This is destructive.',
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
    cubeName: {
      type: 'string',
      required: true,
      description: 'Exact cube name',
      visibility: 'user-or-llm',
    },
    clearInput: {
      type: 'boolean',
      required: false,
      description: 'Clear input data',
      default: false,
      visibility: 'user-or-llm',
    },
    clearAllocatedValues: {
      type: 'boolean',
      required: false,
      description: 'Clear allocated values',
      default: false,
      visibility: 'user-or-llm',
    },
    clearAdjustmentValues: {
      type: 'boolean',
      required: false,
      description: 'Clear adjustment values',
      default: false,
      visibility: 'user-or-llm',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPCM_CALCULATE_MODEL_OUTPUTS,
}
