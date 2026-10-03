import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { TaxUploadFileParams, TaxUploadResponse } from '@/tools/oracle_epm_tax_reporting/types'
import { TAX_UPLOAD_OUTPUTS } from '@/tools/oracle_epm_tax_reporting/types'
import { taxAuthParams, taxFields, taxOAuth } from '@/tools/oracle_epm_tax_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

/** @see https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/upload.html */
export const oracleEpmTaxReportingUploadFileTool: InternalToolConfig<
  TaxUploadFileParams,
  TaxUploadResponse
> = {
  id: 'oracle_epm_tax_reporting_upload_file',
  name: 'Oracle EPM Tax Reporting Upload File',
  description:
    'Upload an authorized Sim file to the Oracle repository (10 MiB maximum). Existing files are not overwritten. Requires Service Administrator or Migrations - Administer.',
  version: '1.0.0',
  oauth: taxOAuth,
  params: {
    ...taxAuthParams,
    file: taxFields.file,
    fileName: taxFields.fileName,
    directory: taxFields.directory,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: TAX_UPLOAD_OUTPUTS,
}
