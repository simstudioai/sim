import { z } from 'zod'
import {
  createFccsContext,
  fccsResult,
  parseFccsInput,
} from '@/lib/internal/oracle-epm-fccs/context'
import { submitFccsConsolidationRulesets } from '@/lib/internal/oracle-epm-fccs/files'
import { fccsName } from '@/lib/internal/oracle-epm-fccs/schemas'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { FccsExportConsolidationRulesetsParams } from '@/tools/oracle_epm_fccs/types'

const inputSchema = z.object({
  application: fccsName,
  rules: z.array(fccsName).min(1).max(1000),
})

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fccs_export_consol_rules.html */
export const executeFccsExportConsolidationRulesetsOperation: InternalToolOperationImplementation<
  FccsExportConsolidationRulesetsParams
> = async (params, signal, context) => {
  const input = parseFccsInput(inputSchema, params)
  const ctx = createFccsContext(params, signal, context)
  return fccsResult(
    await submitFccsConsolidationRulesets(ctx, 'export', input.application, { rules: input.rules })
  )
}
