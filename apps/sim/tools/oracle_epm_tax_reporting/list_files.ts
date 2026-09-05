import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { TaxFilesResponse, TaxListFilesParams } from '@/tools/oracle_epm_tax_reporting/types'
import { TAX_FILES_OUTPUTS } from '@/tools/oracle_epm_tax_reporting/types'
import { taxAuthParams, taxOAuth } from '@/tools/oracle_epm_tax_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

/** @see https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/list_files_v2.html */
export const oracleEpmTaxReportingListFilesTool: InternalToolConfig<
  TaxListFilesParams,
  TaxFilesResponse
> = {
  id: 'oracle_epm_tax_reporting_list_files',
  name: 'Oracle EPM Tax Reporting List Files',
  description:
    'List repository file and snapshot metadata (at most 1,000). Requires Service Administrator or Migrations - Administer.',
  version: '1.0.0',
  oauth: taxOAuth,
  params: {
    ...taxAuthParams,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: TAX_FILES_OUTPUTS,
}
