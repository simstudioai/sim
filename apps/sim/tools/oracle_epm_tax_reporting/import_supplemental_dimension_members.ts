import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  TaxImportSupplementalDimensionMembersParams,
  TaxSupplementalResponse,
} from '@/tools/oracle_epm_tax_reporting/types'
import { TAX_SUPPLEMENTAL_OUTPUTS } from '@/tools/oracle_epm_tax_reporting/types'
import { taxAuthParams, taxFields, taxOAuth } from '@/tools/oracle_epm_tax_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

/** @see https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/sdm_execute_jobs.html */
export const oracleEpmTaxReportingImportSupplementalDimensionMembersTool: InternalToolConfig<
  TaxImportSupplementalDimensionMembersParams,
  TaxSupplementalResponse
> = {
  id: 'oracle_epm_tax_reporting_import_supplemental_dimension_members',
  name: 'Oracle EPM Tax Reporting Import Supplemental Dimension Members',
  description:
    'Import an uploaded CSV into a Supplemental Data dimension. Replace is destructive. Requires Service Administrator or Power User.',
  version: '1.0.0',
  oauth: taxOAuth,
  params: {
    ...taxAuthParams,
    dimension: taxFields.dimension,
    fileName: taxFields.fileName,
    importMode: taxFields.importMode,
    delimiter: taxFields.delimiter,
    dateFormat: taxFields.dateFormat,
    waitForCompletion: taxFields.waitForCompletion,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: TAX_SUPPLEMENTAL_OUTPUTS,
}
