import { planningEndpoints } from '@/lib/internal/oracle-epm-planning/route-space'
import {
  formDataSchema,
  type PlanningOperationContext,
  parsePlanningResponse,
} from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningExportFormDataParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_export_form_data.html */
export async function executeOracleEpmPlanningExportFormData(
  input: OracleEpmPlanningExportFormDataParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  const formData = parsePlanningResponse(
    formDataSchema,
    await context.client.request(planningEndpoints.form, {
      pathParams: { application: input.application, form: input.form },
      query: {
        displayMemberAs: input.displayMemberAs ?? 'MEMBER_NAME',
        memberAliasDelimiter: input.memberAliasDelimiter ?? ':',
        forceStartExpanded: input.forceStartExpanded ?? false,
      },
      signal: context.signal,
    })
  )
  return { success: true, output: { formData } }
}
