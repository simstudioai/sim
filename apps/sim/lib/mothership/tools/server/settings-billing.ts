import { z } from 'zod'
import {
  getOrganizationMemberUsageLimit,
  updateOrganizationMemberUsageLimit,
} from '@/lib/billing/application/member-usage-limits/use-cases'
import {
  memberCreditLimitUpdateSchema,
  usageLimitReadSchema,
  usageLimitUpdateSchema,
} from '@/lib/billing/application/usage-limit-validation'
import { readUsageLimit, updateUsageLimit } from '@/lib/billing/application/usage-limits'
import type { SettingsContext } from '@/lib/mothership/application/settings-context'
import {
  settingsOperation,
  settingsOrganizationId,
} from '@/lib/mothership/tools/server/settings-operation'

function usageTarget(context: SettingsContext) {
  return context.scope === 'organization'
    ? { context: 'organization' as const, organizationId: settingsOrganizationId(context) }
    : { context: 'user' as const }
}

const readSchema = usageLimitReadSchema.pick({ memberLimit: true, memberOffset: true }).strict()
const updateSchema = z.strictObject({
  limit: usageLimitUpdateSchema.shape.limit.describe('Spending cap in US dollars, not credits.'),
})

export async function readSettingsUsageLimit(
  context: SettingsContext,
  input: z.input<typeof readSchema> = {}
) {
  return readUsageLimit.execute({
    principal: context.principal,
    input: { ...input, ...usageTarget(context) },
  })
}

export const usageLimitSettingsActions = {
  get_spending_limit: settingsOperation('read', readSchema, readSettingsUsageLimit),
  set_spending_limit: settingsOperation('write', updateSchema, (context, input) =>
    updateUsageLimit.execute({
      principal: context.principal,
      input: { ...input, ...usageTarget(context) },
    })
  ),
}

const memberInput = z.strictObject({ userId: z.string().min(1).max(200) })
export const memberUsageLimitSettingsActions = {
  get_member_limit: settingsOperation('read', memberInput, (context, input) =>
    getOrganizationMemberUsageLimit.execute({
      principal: context.principal,
      input: { ...input, organizationId: settingsOrganizationId(context) },
    })
  ),
  set_member_limit: settingsOperation(
    'write',
    memberInput.extend({
      creditLimit: memberCreditLimitUpdateSchema.shape.creditLimit.describe(
        'Whole credits, not dollars. Null clears the member limit.'
      ),
    }),
    (context, input) =>
      updateOrganizationMemberUsageLimit.execute({
        principal: context.principal,
        input: { ...input, organizationId: settingsOrganizationId(context) },
      })
  ),
}
