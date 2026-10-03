import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  TaxClearDataSliceParams,
  TaxClearSliceResponse,
} from '@/tools/oracle_epm_tax_reporting/types'
import { TAX_CLEAR_SLICE_OUTPUTS } from '@/tools/oracle_epm_tax_reporting/types'
import { taxAuthParams, taxFields, taxOAuth } from '@/tools/oracle_epm_tax_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

/** @see https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/clear_dataslices.html */
export const oracleEpmTaxReportingClearDataSliceTool: InternalToolConfig<
  TaxClearDataSliceParams,
  TaxClearSliceResponse
> = {
  id: 'oracle_epm_tax_reporting_clear_data_slice',
  name: 'Oracle EPM Tax Reporting Clear Data Slice',
  description:
    'Clear the explicit data region. Numeric data is cleared by default; planning details are retained unless requested. Requires Service Administrator.',
  version: '1.0.0',
  oauth: taxOAuth,
  params: {
    ...taxAuthParams,
    application: taxFields.application,
    planType: taxFields.planType,
    gridDefinition: taxFields.gridDefinition,
    clearEssbaseData: taxFields.clearEssbaseData,
    clearPlanningData: taxFields.clearPlanningData,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: TAX_CLEAR_SLICE_OUTPUTS,
}
