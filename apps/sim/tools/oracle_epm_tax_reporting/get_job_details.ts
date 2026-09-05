import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  TaxDetailsResponse,
  TaxGetJobDetailsParams,
} from '@/tools/oracle_epm_tax_reporting/types'
import { TAX_DETAILS_OUTPUTS } from '@/tools/oracle_epm_tax_reporting/types'
import { taxAuthParams, taxFields, taxOAuth } from '@/tools/oracle_epm_tax_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

/** @see https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/retrieve_job_status_details.html */
export const oracleEpmTaxReportingGetJobDetailsTool: InternalToolConfig<
  TaxGetJobDetailsParams,
  TaxDetailsResponse
> = {
  id: 'oracle_epm_tax_reporting_get_job_details',
  name: 'Oracle EPM Tax Reporting Get Job Details',
  description:
    'Retrieve one page of metadata import/export job details, including child-job-detail links. Requires Service Administrator.',
  version: '1.0.0',
  oauth: taxOAuth,
  params: {
    ...taxAuthParams,
    application: taxFields.application,
    jobId: taxFields.jobId,
    limit: taxFields.limit,
    offset: taxFields.offset,
    messageType: taxFields.messageType,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: TAX_DETAILS_OUTPUTS,
}
