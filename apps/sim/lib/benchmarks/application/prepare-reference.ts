import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { defineAuthorizedBenchmarkUseCase } from '@/lib/benchmarks/application/access'
import { requireBenchmarkCaseAccess } from '@/lib/benchmarks/application/cases'
import { benchmarkOperations } from '@/lib/benchmarks/application/operations'
import { MOTHERSHIP_CHAT_DEFAULT_MODEL } from '@/lib/mothership/constants'

/** Source reads use an owned workspace chat, separate from the planner's enterprise discovery context. */
export const prepareBenchmarkReference = defineAuthorizedBenchmarkUseCase({
  operation: benchmarkOperations.prepareReference,
  async execute({
    principal,
    input,
  }: {
    principal: Principal
    input: { organizationId: string; benchmarkId: string }
  }) {
    const benchmark = await requireBenchmarkCaseAccess(principal, input)
    const userId = benchmark.runAsUserId ?? benchmark.userId
    const [chat] = await db
      .insert(copilotChats)
      .values({
        userId,
        workspaceId: benchmark.sourceWorkspaceId,
        type: 'mothership',
        model: MOTHERSHIP_CHAT_DEFAULT_MODEL,
        config: {
          conversationMode: 'agent',
          benchmark: { id: benchmark.id, operatorUserId: benchmark.userId },
        },
        lastSeenAt: new Date(),
      })
      .returning({ id: copilotChats.id })
    if (!chat) throw new Error('Failed to create benchmark reference conversation')
    return { chatId: chat.id, userId }
  },
})
