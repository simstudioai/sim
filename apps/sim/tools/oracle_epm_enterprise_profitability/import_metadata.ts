import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpcmImportMetadataParams,
  OracleEpcmResponse,
} from '@/tools/oracle_epm_enterprise_profitability/types'
import { ORACLE_EPCM_CALCULATE_MODEL_OUTPUTS } from '@/tools/oracle_epm_enterprise_profitability/types'
import {
  oracleEpcmAuthParams,
  oracleEpcmOAuth,
} from '@/tools/oracle_epm_enterprise_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpcmImportMetadataTool: InternalToolConfig<
  OracleEpcmImportMetadataParams,
  OracleEpcmResponse
> = {
  id: 'oracle_epm_enterprise_profitability_import_metadata',
  name: 'Oracle EPCM Import Metadata',
  description:
    'Run an existing saved metadata import. ZIP entries must match configured dimensions; refreshCube optionally overrides the saved setting.',
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
      description:
        'Exact saved exchange-job name; optional only with complete ad hoc data parameters',
      visibility: 'user-or-llm',
    },
    fileName: {
      type: 'string',
      required: false,
      description: "Optional repository ZIP filename overriding the saved job's files",
      visibility: 'user-or-llm',
    },
    refreshCube: {
      type: 'boolean',
      required: false,
      description: "Override the saved job's cube refresh option",
      visibility: 'user-or-llm',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPCM_CALCULATE_MODEL_OUTPUTS,
}
