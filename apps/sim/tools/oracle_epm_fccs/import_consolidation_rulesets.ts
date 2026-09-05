import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  FccsImportConsolidationRulesetsParams,
  FccsResponse,
} from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fccs_import_consol_rules.html */
export const oracleEpmFccsImportConsolidationRulesetsTool: InternalToolConfig<
  FccsImportConsolidationRulesetsParams,
  FccsResponse
> = {
  id: 'oracle_epm_fccs_import_consolidation_rulesets',
  name: 'Oracle EPM FCCS Import Consolidation Rulesets',
  description:
    'Submit configurable-consolidation ruleset import from an Oracle repository XML file. Oracle returns no job ID.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
    fileName: fccsParamFields.fileName,
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
