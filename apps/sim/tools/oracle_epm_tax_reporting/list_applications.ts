import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  TaxApplicationsResponse,
  TaxListApplicationsParams,
} from '@/tools/oracle_epm_tax_reporting/types'
import { TAX_APPLICATIONS_OUTPUTS } from '@/tools/oracle_epm_tax_reporting/types'
import { taxAuthParams, taxOAuth } from '@/tools/oracle_epm_tax_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

/** @see https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_applications.html */
export const oracleEpmTaxReportingListApplicationsTool: InternalToolConfig<
  TaxListApplicationsParams,
  TaxApplicationsResponse
> = {
  id: 'oracle_epm_tax_reporting_list_applications',
  name: 'Oracle EPM Tax Reporting List Applications',
  description:
    'List applications assigned to the service account (at most 1,000). Requires Service Administrator.',
  version: '1.0.0',
  oauth: taxOAuth,
  params: {
    ...taxAuthParams,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: TAX_APPLICATIONS_OUTPUTS,
}
