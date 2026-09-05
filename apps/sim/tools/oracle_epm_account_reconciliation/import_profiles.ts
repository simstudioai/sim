import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmAccountReconciliationImportProfilesParams,
  OracleEpmAccountReconciliationResponse,
} from '@/tools/oracle_epm_account_reconciliation/types'
import { ARCS_JOB_OUTPUTS } from '@/tools/oracle_epm_account_reconciliation/types'
import { arcsAuthParamFields } from '@/tools/oracle_epm_account_reconciliation/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmAccountReconciliationImportProfilesTool: InternalToolConfig<
  OracleEpmAccountReconciliationImportProfilesParams,
  OracleEpmAccountReconciliationResponse
> = {
  id: 'oracle_epm_account_reconciliation_import_profiles',
  name: 'Oracle EPM Account Reconciliation Import Profiles',
  description: 'Import profile or child-profile definitions from a staged CSV file.',
  version: '1.0.0',
  params: {
    ...arcsAuthParamFields,
    fileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Exact staged profile CSV filename',
    },
    importType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Profile import method',
    },
    profileType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Type of profile definitions',
    },
    dateFormat: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Date format used in the import file, for example MMM d, yyyy',
    },
    period: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reconciliation period name, not its internal ID',
    },
    waitForCompletion: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Wait for the accepted job to finish (default false)',
    },
    maxWaitSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum wait in seconds (5–300; default 60)',
      default: 60,
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ARCS_JOB_OUTPUTS,
}
