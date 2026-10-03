import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpcmListFilesParams,
  OracleEpcmResponse,
} from '@/tools/oracle_epm_enterprise_profitability/types'
import { ORACLE_EPCM_LIST_FILES_OUTPUTS } from '@/tools/oracle_epm_enterprise_profitability/types'
import {
  oracleEpcmAuthParams,
  oracleEpcmOAuth,
} from '@/tools/oracle_epm_enterprise_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpcmListFilesTool: InternalToolConfig<
  OracleEpcmListFilesParams,
  OracleEpcmResponse
> = {
  id: 'oracle_epm_enterprise_profitability_list_files',
  name: 'Oracle EPCM List Repository Files',
  description: 'List ordinary EXTERNAL repository files; exclude LCM snapshots.',
  version: '1.0.0',
  oauth: oracleEpcmOAuth,
  params: {
    ...oracleEpcmAuthParams,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPCM_LIST_FILES_OUTPUTS,
}
