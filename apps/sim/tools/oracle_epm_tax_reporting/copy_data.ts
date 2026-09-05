import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { TaxCopyDataParams, TaxJobResponse } from '@/tools/oracle_epm_tax_reporting/types'
import { TAX_JOB_OUTPUTS } from '@/tools/oracle_epm_tax_reporting/types'
import { taxAuthParams, taxFields, taxOAuth } from '@/tools/oracle_epm_tax_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

/** @see https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/trcs_copy_data.html */
export const oracleEpmTaxReportingCopyDataTool: InternalToolConfig<
  TaxCopyDataParams,
  TaxJobResponse
> = {
  id: 'oracle_epm_tax_reporting_copy_data',
  name: 'Oracle EPM Tax Reporting Copy Data',
  description: 'Run an existing Tax Reporting copy data profile. Requires Service Administrator.',
  version: '1.0.0',
  oauth: taxOAuth,
  params: {
    ...taxAuthParams,
    application: taxFields.application,
    profileName: taxFields.profileName,
    waitForCompletion: taxFields.waitForCompletion,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: TAX_JOB_OUTPUTS,
}
