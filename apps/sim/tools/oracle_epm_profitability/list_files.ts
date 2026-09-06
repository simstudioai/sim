import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OraclePcmListFilesParams,
  OraclePcmResponse,
} from '@/tools/oracle_epm_profitability/types'
import { ORACLE_PCM_FILES_OUTPUTS } from '@/tools/oracle_epm_profitability/types'
import { oraclePcmAuthParams, oraclePcmOAuth } from '@/tools/oracle_epm_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oraclePcmListFilesTool: InternalToolConfig<
  OraclePcmListFilesParams,
  OraclePcmResponse
> = {
  id: 'oracle_epm_profitability_list_files',
  name: 'Oracle PCM List Files',
  description:
    'List ordinary files in profitinbox and profitoutbox, excluding LCM snapshots. Requires Service Administrator or an application role with Migrations - Administer.',
  version: '1.0.0',
  oauth: oraclePcmOAuth,
  params: {
    ...oraclePcmAuthParams,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_PCM_FILES_OUTPUTS,
}
