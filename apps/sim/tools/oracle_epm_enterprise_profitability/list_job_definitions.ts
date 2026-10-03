import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpcmListJobDefinitionsParams,
  OracleEpcmResponse,
} from '@/tools/oracle_epm_enterprise_profitability/types'
import { ORACLE_EPCM_LIST_JOB_DEFINITIONS_OUTPUTS } from '@/tools/oracle_epm_enterprise_profitability/types'
import {
  oracleEpcmAuthParams,
  oracleEpcmOAuth,
} from '@/tools/oracle_epm_enterprise_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpcmListJobDefinitionsTool: InternalToolConfig<
  OracleEpcmListJobDefinitionsParams,
  OracleEpcmResponse
> = {
  id: 'oracle_epm_enterprise_profitability_list_job_definitions',
  name: 'Oracle EPCM List Job Definitions',
  description:
    "List saved data or metadata exchange jobs of one type. EPCM availability requires tenant verification because Oracle's applicability matrix is inconsistent.",
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
    jobType: {
      type: 'string',
      required: true,
      description:
        'Supported saved exchange job type. Allowed values: IMPORT_DATA, EXPORT_DATA, IMPORT_METADATA, EXPORT_METADATA.',
      visibility: 'user-or-llm',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPCM_LIST_JOB_DEFINITIONS_OUTPUTS,
}
