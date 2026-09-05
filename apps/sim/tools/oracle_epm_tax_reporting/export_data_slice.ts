import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  TaxExportDataSliceParams,
  TaxGridResponse,
} from '@/tools/oracle_epm_tax_reporting/types'
import { TAX_GRID_OUTPUTS } from '@/tools/oracle_epm_tax_reporting/types'
import { taxAuthParams, taxFields, taxOAuth } from '@/tools/oracle_epm_tax_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

/** @see https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/export_dataslices.html */
export const oracleEpmTaxReportingExportDataSliceTool: InternalToolConfig<
  TaxExportDataSliceParams,
  TaxGridResponse
> = {
  id: 'oracle_epm_tax_reporting_export_data_slice',
  name: 'Oracle EPM Tax Reporting Export Data Slice',
  description:
    'Export a bounded core data grid for cells the account can access. Does not export cell notes or supporting details. Use Data Integration for general bulk movement.',
  version: '1.0.0',
  oauth: taxOAuth,
  params: {
    ...taxAuthParams,
    application: taxFields.application,
    planType: taxFields.planType,
    gridDefinition: taxFields.gridDefinition,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: TAX_GRID_OUTPUTS,
}
