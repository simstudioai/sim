import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsResponse, FccsRunRulesetParams } from '@/tools/oracle_epm_fccs/types'
import { FCCS_JOB_OUTPUTS } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/ruleset.html */
export const oracleEpmFccsRunRulesetTool: InternalToolConfig<FccsRunRulesetParams, FccsResponse> = {
  id: 'oracle_epm_fccs_run_ruleset',
  name: 'Oracle EPM FCCS Run Ruleset',
  description:
    'Submit a deployed business ruleset with tenant-defined runtime prompts. Wire jobId to Wait for Job.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
    ruleset: fccsParamFields.ruleset,
    parameters: { ...fccsParamFields.parameters, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: FCCS_JOB_OUTPUTS,
}
