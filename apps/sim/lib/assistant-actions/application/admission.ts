import { isDeepStrictEqual } from 'node:util'
import { db } from '@sim/db'
import { copilotAsyncToolCalls, copilotRuns } from '@sim/db/schema'
import { toRecord } from '@sim/utils/object'
import { and, eq, isNull } from 'drizzle-orm'
import {
  lockAssistantActionScope,
  requireAssistantRun,
  resolveAssistantActionPolicy,
} from '@/lib/assistant-actions/application/context'
import { assistantActionOperations } from '@/lib/assistant-actions/application/operations'
import { resolveAssistantActionBinding } from '@/lib/assistant-actions/binding'
import {
  defineAuthorizedOrganizationUseCase,
  type OrganizationUseCaseContext,
} from '@/lib/core/application/authorized-organization-use-case'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { claimAssistantToolExecution } from '@/lib/mothership/async-runs/repository'

interface ActionInput {
  organizationId: string
  runId: string
  toolCallId: string
}

interface ProposalInput extends ActionInput {
  toolId: string
  args: Record<string, unknown>
}

export const prepareOrganizationAssistantAction = defineAuthorizedOrganizationUseCase({
  operation: assistantActionOperations.prepare,
  async execute({ principal, input, context }: OrganizationUseCaseContext<ProposalInput>) {
    await requireAssistantRun(principal, input, context.userId)
    const binding = resolveAssistantActionBinding(input.toolId, input.args)
    return resolveAssistantActionPolicy({ ...context, credentialId: binding.credentialId }, input)
  },
})

/** Nested background reads may run only when the account policy needs no review. */
export const authorizeOrganizationAssistantRead = defineAuthorizedOrganizationUseCase({
  operation: assistantActionOperations.read,
  async execute({
    input,
    context,
  }: OrganizationUseCaseContext<{
    organizationId: string
    toolId: string
    args: Record<string, unknown>
  }>) {
    const binding = resolveAssistantActionBinding(input.toolId, input.args)
    if (binding.effect !== 'read')
      throw new OrchestrationError(
        'forbidden',
        'Write actions require a separately reviewed tool call.'
      )
    const proposal = await resolveAssistantActionPolicy(
      { ...context, credentialId: binding.credentialId },
      input
    )
    if (proposal.policy !== 'allow')
      throw new OrchestrationError(
        'forbidden',
        'This tool requires a separately reviewed tool call.'
      )
  },
})

export const claimOrganizationAssistantAction = defineAuthorizedOrganizationUseCase({
  operation: assistantActionOperations.claim,
  async execute({
    principal,
    input,
    context,
  }: OrganizationUseCaseContext<ActionInput & { ownerToken: string }>) {
    await requireAssistantRun(principal, input, context.userId)
    const [record] = await db
      .select()
      .from(copilotAsyncToolCalls)
      .where(
        and(
          eq(copilotAsyncToolCalls.toolCallId, input.toolCallId),
          eq(copilotAsyncToolCalls.runId, input.runId)
        )
      )
      .limit(1)
    if (!record?.assistantAction || !record.executableName || record.targetWorkspaceId)
      throw new OrchestrationError('not_found', 'Assistant action is unavailable.')
    const toolId = record.executableName
    const scope = { ...context, credentialId: record.assistantAction.credentialId }
    return db.transaction(async (tx) => {
      await lockAssistantActionScope(scope, tx)
      await authorizeOrganizationOperation(principal, assistantActionOperations.claim, input, {
        executor: tx,
        forUpdate: true,
      })
      await requireAssistantRun(principal, input, context.userId, tx)
      const proposal = await resolveAssistantActionPolicy(
        scope,
        { toolId, args: toRecord(record.args) },
        tx
      )
      if (
        !isDeepStrictEqual(proposal.binding, record.assistantAction) ||
        record.executionRetryable !== (proposal.binding.effect === 'read')
      )
        throw new OrchestrationError(
          'conflict',
          'This operation changed. Ask Assistant to propose it again.'
        )
      await tx
        .select({ id: copilotRuns.id })
        .from(copilotRuns)
        .where(eq(copilotRuns.id, input.runId))
        .for('update')
      if (proposal.policy === 'ask') {
        await tx
          .update(copilotAsyncToolCalls)
          .set({ permissionRequestedAt: new Date() })
          .where(
            and(
              eq(copilotAsyncToolCalls.toolCallId, input.toolCallId),
              eq(copilotAsyncToolCalls.status, 'pending'),
              isNull(copilotAsyncToolCalls.executionStartedAt),
              isNull(copilotAsyncToolCalls.permissionRequestedAt)
            )
          )
      }
      return claimAssistantToolExecution({ ...input, userId: context.userId }, tx)
    })
  },
})
