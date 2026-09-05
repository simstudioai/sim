import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpcmExportDataSliceParams,
  OracleEpcmResponse,
} from '@/tools/oracle_epm_enterprise_profitability/types'
import { ORACLE_EPCM_EXPORT_DATA_SLICE_OUTPUTS } from '@/tools/oracle_epm_enterprise_profitability/types'
import {
  oracleEpcmAuthParams,
  oracleEpcmOAuth,
} from '@/tools/oracle_epm_enterprise_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpcmExportDataSliceTool: InternalToolConfig<
  OracleEpcmExportDataSliceParams,
  OracleEpcmResponse
> = {
  id: 'oracle_epm_enterprise_profitability_export_data_slice',
  name: 'Oracle EPCM Export Data Slice',
  description:
    "Read a bounded balance/results grid from a specified cube, preserving Oracle's string cell values. Notes and supporting detail are outside this operation.",
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
    gridDefinition: {
      type: 'json',
      required: true,
      description:
        'Grid definition with pov, rows, and columns axes; each axis has members (string[][]) and optional dimensions. Example: {"pov":{"dimensions":["Scenario"],"members":[["Actual"]]},"rows":[{"dimensions":["Account"],"members":[["Net Income"]]}],"columns":[{"dimensions":["Period"],"members":[["Jan"]]}]}',
      visibility: 'user-or-llm',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPCM_EXPORT_DATA_SLICE_OUTPUTS,
}
