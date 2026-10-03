import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  TaxChildDetailsResponse,
  TaxGetChildJobDetailsParams,
} from '@/tools/oracle_epm_tax_reporting/types'
import { TAX_CHILD_DETAILS_OUTPUTS } from '@/tools/oracle_epm_tax_reporting/types'
import { taxAuthParams, taxFields, taxOAuth } from '@/tools/oracle_epm_tax_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

/** @see https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/retrieve_child_job_status_details.html */
export const oracleEpmTaxReportingGetChildJobDetailsTool: InternalToolConfig<
  TaxGetChildJobDetailsParams,
  TaxChildDetailsResponse
> = {
  id: 'oracle_epm_tax_reporting_get_child_job_details',
  name: 'Oracle EPM Tax Reporting Get Child Job Details',
  description:
    'Retrieve one page of child-job diagnostic messages. Requires Service Administrator.',
  version: '1.0.0',
  oauth: taxOAuth,
  params: {
    ...taxAuthParams,
    application: taxFields.application,
    jobId: taxFields.jobId,
    childJobId: taxFields.childJobId,
    limit: taxFields.limit,
    offset: taxFields.offset,
    messageType: taxFields.messageType,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: TAX_CHILD_DETAILS_OUTPUTS,
}
