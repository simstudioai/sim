import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { TaxClearDataParams, TaxJobResponse } from '@/tools/oracle_epm_tax_reporting/types'
import { TAX_JOB_OUTPUTS } from '@/tools/oracle_epm_tax_reporting/types'
import { taxAuthParams, taxFields, taxOAuth } from '@/tools/oracle_epm_tax_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

/** @see https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/trcs_clear_data.html */
export const oracleEpmTaxReportingClearDataTool: InternalToolConfig<
  TaxClearDataParams,
  TaxJobResponse
> = {
  id: 'oracle_epm_tax_reporting_clear_data',
  name: 'Oracle EPM Tax Reporting Clear Data',
  description:
    'Run an existing Tax Reporting clear data profile. Its configured POV is deleted. Requires Service Administrator.',
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
