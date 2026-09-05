import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  TaxDefinitionsResponse,
  TaxListJobDefinitionsParams,
} from '@/tools/oracle_epm_tax_reporting/types'
import { TAX_DEFINITIONS_OUTPUTS } from '@/tools/oracle_epm_tax_reporting/types'
import { taxAuthParams, taxFields, taxOAuth } from '@/tools/oracle_epm_tax_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

/** @see https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_job_definitions.html */
export const oracleEpmTaxReportingListJobDefinitionsTool: InternalToolConfig<
  TaxListJobDefinitionsParams,
  TaxDefinitionsResponse
> = {
  id: 'oracle_epm_tax_reporting_list_job_definitions',
  name: 'Oracle EPM Tax Reporting List Job Definitions',
  description:
    'List deployed job definitions (not submitted job instances), optionally filtering supported Tax Reporting job types. Requires Service Administrator.',
  version: '1.0.0',
  oauth: taxOAuth,
  params: {
    ...taxAuthParams,
    application: taxFields.application,
    jobType: { ...taxFields.jobType, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: TAX_DEFINITIONS_OUTPUTS,
}
