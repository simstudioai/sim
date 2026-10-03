import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { TaxExecuteJobParams, TaxJobResponse } from '@/tools/oracle_epm_tax_reporting/types'
import { TAX_JOB_OUTPUTS } from '@/tools/oracle_epm_tax_reporting/types'
import { taxAuthParams, taxFields, taxOAuth } from '@/tools/oracle_epm_tax_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

/** @see https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/execute_a_job.html */
export const oracleEpmTaxReportingExecuteJobTool: InternalToolConfig<
  TaxExecuteJobParams,
  TaxJobResponse
> = {
  id: 'oracle_epm_tax_reporting_execute_job',
  name: 'Oracle EPM Tax Reporting Execute Job',
  description:
    'Execute a discovered RULES, RULESET, EXPORT_METADATA, or IMPORT_METADATA definition only. Requires Service Administrator. No arbitrary EPM jobs or general bulk data movement.',
  version: '1.0.0',
  oauth: taxOAuth,
  params: {
    ...taxAuthParams,
    application: taxFields.application,
    jobType: taxFields.jobType,
    jobName: taxFields.jobName,
    parameters: taxFields.parameters,
    waitForCompletion: taxFields.waitForCompletion,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: TAX_JOB_OUTPUTS,
}
