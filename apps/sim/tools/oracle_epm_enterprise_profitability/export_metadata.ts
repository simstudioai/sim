import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpcmExportMetadataParams,
  OracleEpcmResponse,
} from '@/tools/oracle_epm_enterprise_profitability/types'
import { ORACLE_EPCM_CALCULATE_MODEL_OUTPUTS } from '@/tools/oracle_epm_enterprise_profitability/types'
import {
  oracleEpcmAuthParams,
  oracleEpcmOAuth,
} from '@/tools/oracle_epm_enterprise_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpcmExportMetadataTool: InternalToolConfig<
  OracleEpcmExportMetadataParams,
  OracleEpcmResponse
> = {
  id: 'oracle_epm_enterprise_profitability_export_metadata',
  name: 'Oracle EPCM Export Metadata',
  description: 'Run an existing saved metadata export to a repository ZIP file.',
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
      description: 'Exact saved metadata export job name; an existing job is required',
      visibility: 'user-or-llm',
    },
    fileName: {
      type: 'string',
      required: false,
      description: 'Optional output ZIP filename; existing output may be replaced by Oracle',
      visibility: 'user-or-llm',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPCM_CALCULATE_MODEL_OUTPUTS,
}
