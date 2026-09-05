import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpcmCopyPovParams,
  OracleEpcmResponse,
} from '@/tools/oracle_epm_enterprise_profitability/types'
import { ORACLE_EPCM_CALCULATE_MODEL_OUTPUTS } from '@/tools/oracle_epm_enterprise_profitability/types'
import {
  oracleEpcmAuthParams,
  oracleEpcmOAuth,
} from '@/tools/oracle_epm_enterprise_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpcmCopyPovTool: InternalToolConfig<
  OracleEpcmCopyPovParams,
  OracleEpcmResponse
> = {
  id: 'oracle_epm_enterprise_profitability_copy_pov',
  name: 'Oracle EPCM Copy POV Data',
  description:
    'Copy existing POV data between explicitly identified source and destination POVs and cubes.',
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
    sourcePOVName: {
      type: 'string',
      required: true,
      description: 'Source POV members joined with the delimiter',
      visibility: 'user-or-llm',
    },
    destPOVName: {
      type: 'string',
      required: true,
      description: 'Destination POV members joined with the delimiter',
      visibility: 'user-or-llm',
    },
    sourceCubeName: {
      type: 'string',
      required: true,
      description: 'Source cube',
      visibility: 'user-or-llm',
    },
    destCubeName: {
      type: 'string',
      required: true,
      description: 'Destination cube',
      visibility: 'user-or-llm',
    },
    copyType: {
      type: 'string',
      required: true,
      description: 'Copy all data or only input data. Allowed values: ALL_DATA, INPUT.',
      visibility: 'user-or-llm',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPCM_CALCULATE_MODEL_OUTPUTS,
}
