import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  TaxImportSupplementalCollectionDataParams,
  TaxSupplementalResponse,
} from '@/tools/oracle_epm_tax_reporting/types'
import { TAX_SUPPLEMENTAL_OUTPUTS } from '@/tools/oracle_epm_tax_reporting/types'
import { taxAuthParams, taxFields, taxOAuth } from '@/tools/oracle_epm_tax_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

/** @see https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fccs_import_supplemental_data.html */
export const oracleEpmTaxReportingImportSupplementalCollectionDataTool: InternalToolConfig<
  TaxImportSupplementalCollectionDataParams,
  TaxSupplementalResponse
> = {
  id: 'oracle_epm_tax_reporting_import_supplemental_collection_data',
  name: 'Oracle EPM Tax Reporting Import Supplemental Collection Data',
  description:
    'Import an uploaded collection CSV for a year, period, and configured frequency dimensions. Requires Service Administrator and Supplemental Data.',
  version: '1.0.0',
  oauth: taxOAuth,
  params: {
    ...taxAuthParams,
    application: taxFields.application,
    fileName: taxFields.fileName,
    collection: taxFields.collection,
    year: taxFields.year,
    period: taxFields.period,
    frequencyDimensions: taxFields.frequencyDimensions,
    jobName: {
      ...taxFields.jobName,
      required: false,
      description:
        'Optional name for this supplemental job submission, not a deployed Planning job definition.',
    },
    waitForCompletion: taxFields.waitForCompletion,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: TAX_SUPPLEMENTAL_OUTPUTS,
}
