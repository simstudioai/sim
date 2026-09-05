import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { TaxJobResponse, TaxRunRuleParams } from '@/tools/oracle_epm_tax_reporting/types'
import { TAX_JOB_OUTPUTS } from '@/tools/oracle_epm_tax_reporting/types'
import { taxAuthParams, taxFields, taxOAuth } from '@/tools/oracle_epm_tax_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

/** @see https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/rules.html */
export const oracleEpmTaxReportingRunRuleTool: InternalToolConfig<
  TaxRunRuleParams,
  TaxJobResponse
> = {
  id: 'oracle_epm_tax_reporting_run_rule',
  name: 'Oracle EPM Tax Reporting Run Rule',
  description:
    'Launch a standalone-launchable deployed business rule (many seeded Tax Automation rules are internal and cannot be launched independently), with exact runtime prompts. Requires Service Administrator or Power User with Rules launch permission.',
  version: '1.0.0',
  oauth: taxOAuth,
  params: {
    ...taxAuthParams,
    application: taxFields.application,
    jobName: taxFields.jobName,
    parameters: taxFields.parameters,
    waitForCompletion: taxFields.waitForCompletion,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: TAX_JOB_OUTPUTS,
}
