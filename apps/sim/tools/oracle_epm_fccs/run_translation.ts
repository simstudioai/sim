import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsResponse, FccsRunTranslationParams } from '@/tools/oracle_epm_fccs/types'
import { FCCS_JOB_OUTPUTS } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/rules.html */
export const oracleEpmFccsRunTranslationTool: InternalToolConfig<
  FccsRunTranslationParams,
  FccsResponse
> = {
  id: 'oracle_epm_fccs_run_translation',
  name: 'Oracle EPM FCCS Run Translation',
  description:
    'Submit the seeded Translate or ForceTranslate rule for an entity, period, scenario, and year.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
    entity: fccsParamFields.entity,
    period: fccsParamFields.period,
    scenario: fccsParamFields.scenario,
    year: fccsParamFields.year,
    force: { ...fccsParamFields.force, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: FCCS_JOB_OUTPUTS,
}
