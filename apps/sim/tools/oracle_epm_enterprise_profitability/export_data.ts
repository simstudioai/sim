import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpcmExportDataParams,
  OracleEpcmResponse,
} from '@/tools/oracle_epm_enterprise_profitability/types'
import { ORACLE_EPCM_CALCULATE_MODEL_OUTPUTS } from '@/tools/oracle_epm_enterprise_profitability/types'
import {
  oracleEpcmAuthParams,
  oracleEpcmOAuth,
} from '@/tools/oracle_epm_enterprise_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpcmExportDataTool: InternalToolConfig<
  OracleEpcmExportDataParams,
  OracleEpcmResponse
> = {
  id: 'oracle_epm_enterprise_profitability_export_data',
  name: 'Oracle EPCM Export Data',
  description:
    'Run a saved data export or provide a complete cube/row/column/POV selection for an ad hoc ZIP export.',
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
      required: false,
      description:
        'Exact saved exchange-job name; optional only with complete ad hoc data parameters',
      visibility: 'user-or-llm',
    },
    fileName: {
      type: 'string',
      required: false,
      description: 'Optional output ZIP filename; existing output may be replaced by Oracle',
      visibility: 'user-or-llm',
    },
    cubeName: {
      type: 'string',
      required: false,
      description: 'Cube required for an ad hoc export',
      visibility: 'user-or-llm',
    },
    rowMembers: {
      type: 'string',
      required: false,
      description: 'Row members or supported member expressions; required for an ad hoc export',
      visibility: 'user-or-llm',
    },
    columnMembers: {
      type: 'string',
      required: false,
      description: 'Column members or supported member expressions; required for an ad hoc export',
      visibility: 'user-or-llm',
    },
    povMembers: {
      type: 'string',
      required: false,
      description: 'POV members or supported member expressions; required for an ad hoc export',
      visibility: 'user-or-llm',
    },
    delimiter: {
      type: 'string',
      required: false,
      description: 'Export file delimiter. Allowed values: comma, tab.',
      visibility: 'user-or-llm',
    },
    includeDynamicMembers: {
      type: 'boolean',
      required: false,
      description: 'Include dynamic members',
      visibility: 'user-or-llm',
    },
    exportDataDecimalScale: {
      type: 'number',
      required: false,
      description: 'Optional decimal formatting, 0–16; omit to preserve Essbase precision',
      visibility: 'user-or-llm',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPCM_CALCULATE_MODEL_OUTPUTS,
}
