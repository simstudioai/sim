import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  TaxGetApiVersionParams,
  TaxVersionResponse,
} from '@/tools/oracle_epm_tax_reporting/types'
import { TAX_VERSION_OUTPUTS } from '@/tools/oracle_epm_tax_reporting/types'
import { taxAuthParams, taxOAuth } from '@/tools/oracle_epm_tax_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

/** @see https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/trcs_get_specific_api_version.html */
export const oracleEpmTaxReportingGetApiVersionTool: InternalToolConfig<
  TaxGetApiVersionParams,
  TaxVersionResponse
> = {
  id: 'oracle_epm_tax_reporting_get_api_version',
  name: 'Oracle EPM Tax Reporting Get API Version',
  description: 'Inspect the supported v3 Tax Reporting API version.',
  version: '1.0.0',
  oauth: taxOAuth,
  params: {
    ...taxAuthParams,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: TAX_VERSION_OUTPUTS,
}
