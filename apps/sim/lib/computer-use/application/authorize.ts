import type { SessionPrincipal } from '@sim/auth/principal'
import { ComputerUseSchema } from '@sim/desktop-bridge/computer-use'
import { isComputerUseAvailable } from '@/lib/computer-use/availability.server'
import { claimComputerUseTool } from '@/lib/computer-use/repository'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getAsyncToolCall, getRunSegment } from '@/lib/mothership/async-runs/repository'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'

interface AuthorizeComputerUseInput {
  toolCallId: string
}

/** Authorizes and consumes one server-authored native action under the current private-chat policy. */
export const authorizeComputerUse = defineAuthorizedChatUseCase({
  operation: defineWorkspaceOperation({
    id: 'desktop.computer.execute',
    minimumRole: 'read',
    workspaceApiKey: 'deny',
    capability: 'copilot.use',
    principalKinds: ['session'],
  }),
  organizationOperation: defineOrganizationOperation({
    id: 'desktop.computer.execute',
    minimumRole: 'member',
    capability: 'copilot.use',
    principalKinds: ['session'],
  }),
  async resolveContext({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: AuthorizeComputerUseInput
  }) {
    const tool = await getAsyncToolCall(input.toolCallId)
    if (!tool || tool.toolName !== 'computer' || tool.status !== 'pending')
      throw new OrchestrationError('not_found', 'Pending computer action not found')
    const run = await getRunSegment(tool.runId)
    if (
      !run ||
      run.userId !== principal.userId ||
      run.toolAdmissionClosedAt ||
      ['complete', 'error', 'cancelled'].includes(run.status)
    )
      throw new OrchestrationError('not_found', 'Pending computer action not found')
    const context = await resolveOwnedChatContext(principal, run.chatId)
    if (
      context.mode === 'assistant' ||
      context.workspaceId !== (run.workspaceId ?? undefined) ||
      context.organizationId !== (run.organizationId ?? undefined)
    )
      throw new OrchestrationError(
        'not_found',
        'Computer action does not belong to this conversation'
      )
    return { ...context, runId: run.id }
  },
  authorizationOptions: {},
  async execute({ principal, context, input }) {
    if (!(await isComputerUseAvailable()))
      throw new OrchestrationError('forbidden', 'Computer use is unavailable on this deployment')
    const claimed = await claimComputerUseTool({
      toolCallId: input.toolCallId,
      runId: context.runId,
      chatId: context.chatId,
      userId: principal.userId,
    })
    if (!claimed)
      throw new OrchestrationError(
        'not_found',
        'Pending computer action not found; it may already have started'
      )
    return {
      toolName: 'computer' as const,
      args: ComputerUseSchema.parse(claimed.args),
      chatId: context.chatId,
    }
  },
})
