import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  TaxExportMetadataParams,
  TaxJobResponse,
} from '@/tools/oracle_epm_tax_reporting/types'
import { TAX_JOB_OUTPUTS } from '@/tools/oracle_epm_tax_reporting/types'
import { taxAuthParams, taxFields, taxOAuth } from '@/tools/oracle_epm_tax_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

/** @see https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/export_metadata.html */
export const oracleEpmTaxReportingExportMetadataTool: InternalToolConfig<
  TaxExportMetadataParams,
  TaxJobResponse
> = {
  id: 'oracle_epm_tax_reporting_export_metadata',
  name: 'Oracle EPM Tax Reporting Export Metadata',
  description:
    'Run a saved metadata export job to create a repository ZIP. Download it separately after successful completion. Requires Service Administrator.',
  version: '1.0.0',
  oauth: taxOAuth,
  params: {
    ...taxAuthParams,
    application: taxFields.application,
    jobName: taxFields.jobName,
    exportZipFileName: taxFields.exportZipFileName,
    waitForCompletion: taxFields.waitForCompletion,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: TAX_JOB_OUTPUTS,
}
