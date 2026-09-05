import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  FccsExportConsolidationRulesetsParams,
  FccsResponse,
} from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fccs_export_consol_rules.html */
export const oracleEpmFccsExportConsolidationRulesetsTool: InternalToolConfig<
  FccsExportConsolidationRulesetsParams,
  FccsResponse
> = {
  id: 'oracle_epm_fccs_export_consolidation_rulesets',
  name: 'Oracle EPM FCCS Export Consolidation Rulesets',
  description:
    'Submit configurable-consolidation ruleset export and return its text acknowledgment. Oracle returns no job ID.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
    rules: fccsParamFields.rules,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    submitted: {
      type: 'boolean',
      description: 'Oracle acknowledged submission; completion and job ID are not returned',
    },
    message: {
      type: 'string',
      description: 'Documented submission acknowledgement',
    },
  },
}
