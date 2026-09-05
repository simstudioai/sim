import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  TaxImportMetadataParams,
  TaxJobResponse,
} from '@/tools/oracle_epm_tax_reporting/types'
import { TAX_JOB_OUTPUTS } from '@/tools/oracle_epm_tax_reporting/types'
import { taxAuthParams, taxFields, taxOAuth } from '@/tools/oracle_epm_tax_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

/** @see https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/import_metadata.html */
export const oracleEpmTaxReportingImportMetadataTool: InternalToolConfig<
  TaxImportMetadataParams,
  TaxJobResponse
> = {
  id: 'oracle_epm_tax_reporting_import_metadata',
  name: 'Oracle EPM Tax Reporting Import Metadata',
  description:
    'Run a saved metadata import job using an already uploaded ZIP, optionally refreshing the cube. Requires Service Administrator.',
  version: '1.0.0',
  oauth: taxOAuth,
  params: {
    ...taxAuthParams,
    application: taxFields.application,
    jobName: taxFields.jobName,
    importZipFileName: taxFields.importZipFileName,
    refreshCube: taxFields.refreshCube,
    errorFile: taxFields.errorFile,
    waitForCompletion: taxFields.waitForCompletion,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: TAX_JOB_OUTPUTS,
}
