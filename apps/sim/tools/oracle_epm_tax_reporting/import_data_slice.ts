import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  TaxImportDataSliceParams,
  TaxImportSliceResponse,
} from '@/tools/oracle_epm_tax_reporting/types'
import { TAX_IMPORT_SLICE_OUTPUTS } from '@/tools/oracle_epm_tax_reporting/types'
import { taxAuthParams, taxFields, taxOAuth } from '@/tools/oracle_epm_tax_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

/** @see https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/import_dataslices.html */
export const oracleEpmTaxReportingImportDataSliceTool: InternalToolConfig<
  TaxImportDataSliceParams,
  TaxImportSliceResponse
> = {
  id: 'oracle_epm_tax_reporting_import_data_slice',
  name: 'Oracle EPM Tax Reporting Import Data Slice',
  description:
    'Import a bounded core JSON data grid and inspect rejected cells. Does not import cell notes or supporting details. Use Data Integration for general bulk movement.',
  version: '1.0.0',
  oauth: taxOAuth,
  params: {
    ...taxAuthParams,
    application: taxFields.application,
    planType: taxFields.planType,
    dataGrid: taxFields.dataGrid,
    aggregateEssbaseData: taxFields.aggregateEssbaseData,
    dateFormat: taxFields.dateFormat,
    strictDateValidation: taxFields.strictDateValidation,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: TAX_IMPORT_SLICE_OUTPUTS,
}
