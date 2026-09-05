import { z } from 'zod'
import { createFccsContext, parseFccsInput } from '@/lib/internal/oracle-epm-fccs/context'
import { submitFccsJob } from '@/lib/internal/oracle-epm-fccs/jobs'
import { fccsName } from '@/lib/internal/oracle-epm-fccs/schemas'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { FccsRunTranslationParams } from '@/tools/oracle_epm_fccs/types'

const inputSchema = z.object({
  application: fccsName,
  entity: fccsName,
  period: fccsName,
  scenario: fccsName,
  year: fccsName,
  force: z.boolean().default(false),
})

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/rules.html */
export const executeFccsRunTranslationOperation: InternalToolOperationImplementation<
  FccsRunTranslationParams
> = async (params, signal, context) => {
  const input = parseFccsInput(inputSchema, params)
  const ctx = createFccsContext(params, signal, context)
  /** Translation is available only in multi-currency applications; these are the prompted seeded rules. */
  return submitFccsJob(
    ctx,
    input.application,
    'RULES',
    input.force ? 'ForceTranslate' : 'Translate',
    { Entity: input.entity, Period: input.period, Scenario: input.scenario, Year: input.year }
  )
}
