import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  TaxGenerateUserDetailsReportParams,
  TaxReportJobResponse,
} from '@/tools/oracle_epm_tax_reporting/types'
import { TAX_REPORT_JOB_OUTPUTS } from '@/tools/oracle_epm_tax_reporting/types'
import { taxAuthParams, taxFields, taxOAuth } from '@/tools/oracle_epm_tax_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

/** @see https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/reports_arcs_fccs_trcs_generate_user_details_report.html */
export const oracleEpmTaxReportingGenerateUserDetailsReportTool: InternalToolConfig<
  TaxGenerateUserDetailsReportParams,
  TaxReportJobResponse
> = {
  id: 'oracle_epm_tax_reporting_generate_user_details_report',
  name: 'Oracle EPM Tax Reporting Generate User Details Report',
  description:
    'Generate a CSV or XLS report of Task Manager and Supplemental Data user assignments. Requires Service Administrator.',
  version: '1.0.0',
  oauth: taxOAuth,
  params: {
    ...taxAuthParams,
    fileName: taxFields.fileName,
    format: { ...taxFields.format, description: 'CSV (default) or XLS.' },
    waitForCompletion: taxFields.waitForCompletion,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: TAX_REPORT_JOB_OUTPUTS,
}
