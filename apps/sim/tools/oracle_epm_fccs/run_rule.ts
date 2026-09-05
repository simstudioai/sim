import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsResponse, FccsRunRuleParams } from '@/tools/oracle_epm_fccs/types'
import { FCCS_JOB_OUTPUTS } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/rules.html */
export const oracleEpmFccsRunRuleTool: InternalToolConfig<FccsRunRuleParams, FccsResponse> = {
  id: 'oracle_epm_fccs_run_rule',
  name: 'Oracle EPM FCCS Run Rule',
  description:
    'Submit a deployed business rule with case-sensitive tenant runtime prompts. Wire jobId to Wait for Job.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
    rule: fccsParamFields.rule,
    parameters: { ...fccsParamFields.parameters, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: FCCS_JOB_OUTPUTS,
}
