import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { TaxAddMemberParams, TaxMemberResponse } from '@/tools/oracle_epm_tax_reporting/types'
import { TAX_MEMBER_OUTPUTS } from '@/tools/oracle_epm_tax_reporting/types'
import { taxAuthParams, taxFields, taxOAuth } from '@/tools/oracle_epm_tax_reporting/utils'
import type { InternalToolConfig } from '@/tools/types'

/** @see https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/add_member.html */
export const oracleEpmTaxReportingAddMemberTool: InternalToolConfig<
  TaxAddMemberParams,
  TaxMemberResponse
> = {
  id: 'oracle_epm_tax_reporting_add_member',
  name: 'Oracle EPM Tax Reporting Add Member',
  description:
    'Add a member under a dynamic-child-enabled parent after a cube refresh. Requires Service Administrator.',
  version: '1.0.0',
  oauth: taxOAuth,
  params: {
    ...taxAuthParams,
    application: taxFields.application,
    dimension: taxFields.dimension,
    memberName: taxFields.memberName,
    parentName: taxFields.parentName,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: TAX_MEMBER_OUTPUTS,
}
