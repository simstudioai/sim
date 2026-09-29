import type { Principal } from '@sim/auth/principal'
import {
  authorizeBenchmarkTarget,
  defineAuthorizedBenchmarkUseCase,
} from '@/lib/benchmarks/application/access'
import { requireBenchmarkCaseAccess } from '@/lib/benchmarks/application/cases'
import { benchmarkOperations } from '@/lib/benchmarks/application/operations'
import {
  createOrganizationChatRecord,
  requireOrganizationBuildPermission,
} from '@/lib/mothership/chat/organization-chats'

/** The target owns the isolated agent context; the operator owns the benchmark and report. */
export const prepareBenchmarkPlan = defineAuthorizedBenchmarkUseCase({
  operation: benchmarkOperations.preparePlan,
  async execute({
    principal,
    input,
  }: {
    principal: Principal
    input: { organizationId: string; benchmarkId: string }
  }) {
    const benchmark = await requireBenchmarkCaseAccess(principal, input)
    const target = await authorizeBenchmarkTarget(principal, {
      organizationId: benchmark.organizationId,
      runAsUserId: benchmark.runAsUserId ?? benchmark.userId,
    })
    await requireOrganizationBuildPermission(target)
    const chat = await createOrganizationChatRecord(target, 'plan', {
      id: benchmark.id,
      operatorUserId: benchmark.userId,
    })
    return { chatId: chat.id, userId: target.userId, organizationId: target.organizationId }
  },
})
