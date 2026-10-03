import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { TaxDownloadFileParams, TaxFileResponse } from '@/tools/oracle_epm_tax_reporting/types'
import { TAX_FILE_OUTPUTS } from '@/tools/oracle_epm_tax_reporting/types'
import { taxAuthParams, taxFields, taxOAuth } from '@/tools/oracle_epm_tax_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

/** @see https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/download.html */
export const oracleEpmTaxReportingDownloadFileTool: InternalToolConfig<
  TaxDownloadFileParams,
  TaxFileResponse
> = {
  id: 'oracle_epm_tax_reporting_download_file',
  name: 'Oracle EPM Tax Reporting Download File',
  description:
    'Stream an Oracle repository file into a canonical Sim UserFile (100 MiB maximum, subject to platform limits). Requires Service Administrator or Migrations - Administer.',
  version: '1.0.0',
  oauth: taxOAuth,
  params: {
    ...taxAuthParams,
    fileName: taxFields.fileName,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: TAX_FILE_OUTPUTS,
}
