import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpcmImportDataParams,
  OracleEpcmResponse,
} from '@/tools/oracle_epm_enterprise_profitability/types'
import { ORACLE_EPCM_CALCULATE_MODEL_OUTPUTS } from '@/tools/oracle_epm_enterprise_profitability/types'
import {
  oracleEpcmAuthParams,
  oracleEpcmOAuth,
} from '@/tools/oracle_epm_enterprise_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpcmImportDataTool: InternalToolConfig<
  OracleEpcmImportDataParams,
  OracleEpcmResponse
> = {
  id: 'oracle_epm_enterprise_profitability_import_data',
  name: 'Oracle EPCM Import Data',
  description:
    'Run a saved data import or provide a repository file and source type for an ad hoc import. Essbase source requires a cube.',
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
      description: 'Raw repository filename, including ordinary folders; do not URL-encode it',
      visibility: 'user-or-llm',
    },
    sourceType: {
      type: 'string',
      required: false,
      description: 'Required for an ad hoc import. Allowed values: Planning, Essbase.',
      visibility: 'user-or-llm',
    },
    cubeName: {
      type: 'string',
      required: false,
      description: 'Cube required for an ad hoc Essbase import',
      visibility: 'user-or-llm',
    },
    delimiter: {
      type: 'string',
      required: false,
      description: 'Planning-format file delimiter. Allowed values: comma, tab.',
      visibility: 'user-or-llm',
    },
    includeMetaData: {
      type: 'boolean',
      required: false,
      description: 'Include metadata from a Planning-format file',
      visibility: 'user-or-llm',
    },
    stopOnError: {
      type: 'boolean',
      required: false,
      description: 'Stop on intermediate Essbase import errors',
      visibility: 'user-or-llm',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPCM_CALCULATE_MODEL_OUTPUTS,
}
