import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpcmImportDataSliceParams,
  OracleEpcmResponse,
} from '@/tools/oracle_epm_enterprise_profitability/types'
import { ORACLE_EPCM_IMPORT_DATA_SLICE_OUTPUTS } from '@/tools/oracle_epm_enterprise_profitability/types'
import {
  oracleEpcmAuthParams,
  oracleEpcmOAuth,
} from '@/tools/oracle_epm_enterprise_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpcmImportDataSliceTool: InternalToolConfig<
  OracleEpcmImportDataSliceParams,
  OracleEpcmResponse
> = {
  id: 'oracle_epm_enterprise_profitability_import_data_slice',
  name: 'Oracle EPCM Import Data Slice',
  description:
    'Write a bounded data grid. Aggregation adds values and is not idempotent; it is off by default. Cell notes are left unchanged.',
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
    cubeName: {
      type: 'string',
      required: true,
      description: 'Exact cube name',
      visibility: 'user-or-llm',
    },
    dataGrid: {
      type: 'json',
      required: true,
      description:
        'Grid with pov (string[]), columns (string[][]), and rows containing headers (string[]) and data (strings/numbers). Example: {"pov":["Actual"],"columns":[["Jan"]],"rows":[{"headers":["Revenue"],"data":["125.00"]}]}',
      visibility: 'user-or-llm',
    },
    aggregateEssbaseData: {
      type: 'boolean',
      required: false,
      description: 'Add values to existing data instead of overwriting',
      default: false,
      visibility: 'user-or-llm',
    },
    dateFormat: {
      type: 'string',
      required: false,
      description:
        'Date format for date cells. Allowed values: MM-DD-YYYY, DD-MM-YYYY, YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY, YYYY/MM/DD.',
      visibility: 'user-or-llm',
    },
    strictDateValidation: {
      type: 'boolean',
      required: false,
      description: 'Reject invalid dates',
      default: true,
      visibility: 'user-or-llm',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPCM_IMPORT_DATA_SLICE_OUTPUTS,
}
