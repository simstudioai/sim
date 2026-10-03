import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { TaxGetMemberParams, TaxMemberResponse } from '@/tools/oracle_epm_tax_reporting/types'
import { TAX_MEMBER_OUTPUTS } from '@/tools/oracle_epm_tax_reporting/types'
import { taxAuthParams, taxFields, taxOAuth } from '@/tools/oracle_epm_tax_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

/** @see https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_member.html */
export const oracleEpmTaxReportingGetMemberTool: InternalToolConfig<
  TaxGetMemberParams,
  TaxMemberResponse
> = {
  id: 'oracle_epm_tax_reporting_get_member',
  name: 'Oracle EPM Tax Reporting Get Member',
  description: 'Look up a dimension member by its exact name. Requires Service Administrator.',
  version: '1.0.0',
  oauth: taxOAuth,
  params: {
    ...taxAuthParams,
    application: taxFields.application,
    dimension: taxFields.dimension,
    memberName: taxFields.memberName,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: TAX_MEMBER_OUTPUTS,
}
