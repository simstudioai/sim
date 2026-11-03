import { isDeepStrictEqual } from 'node:util'
import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { copilotAsyncToolCalls, copilotChats, copilotRuns } from '@sim/db/schema'
import { toRecord } from '@sim/utils/object'
import { and, asc, desc, eq, gt, gte, isNotNull, isNull, notInArray, or } from 'drizzle-orm'
import {
  lockAssistantActionScope,
  requireAssistantRun,
  resolveAssistantActionPolicy,
} from '@/lib/assistant-actions/application/context'
import { assistantActionOperations } from '@/lib/assistant-actions/application/operations'
import {
  applyAssistantReviewEdits,
  assistantProposalVersion,
  assistantReviewFields,
} from '@/lib/assistant-actions/proposal'
import { loadAssistantAccount } from '@/lib/assistant-actions/tool-permissions'
import { acquireOrganizationUserMutationLocks } from '@/lib/billing/organizations/membership'
import {
  defineAuthorizedOrganizationUseCase,
  type OrganizationUseCaseContext,
} from '@/lib/core/application/authorized-organization-use-case'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { SIM_TOOL_MIN_START_BUDGET_MS } from '@/lib/mothership/async-runs/execution-lease'
import {
  recordToolPermissionDecision,
  TERMINAL_RUN_STATUSES,
} from '@/lib/mothership/async-runs/repository'
import { publishToolPermissionDecision } from '@/lib/mothership/persistence/tool-permission'
import { toolStartWindowClosed } from '@/lib/mothership/request/tools/deadline'
import { getToolMetadata } from '@/tools/metadata'

interface ReviewInput {
  organizationId: string
  chatId: string
  runId: string
}

export const listOrganizationAssistantActions = defineAuthorizedOrganizationUseCase({
  operation: assistantActionOperations.list,
  async execute({
    principal,
    input,
    context,
  }: OrganizationUseCaseContext<Omit<ReviewInput, 'runId'> & { cursor?: number }>) {
    const [latest] = await db
      .select({ id: copilotRuns.id })
      .from(copilotRuns)
      .innerJoin(copilotChats, eq(copilotChats.id, copilotRuns.chatId))
      .where(
        and(
          eq(copilotRuns.chatId, input.chatId),
          eq(copilotRuns.organizationId, context.organizationId),
          eq(copilotRuns.userId, context.userId),
          eq(copilotChats.userId, context.userId),
          eq(copilotChats.organizationId, context.organizationId),
          eq(copilotChats.conversationId, copilotRuns.streamId),
          isNull(copilotChats.deletedAt),
          isNull(copilotRuns.toolAdmissionClosedAt),
          notInArray(copilotRuns.status, TERMINAL_RUN_STATUSES)
        )
      )
      .orderBy(desc(copilotRuns.startedAt), desc(copilotRuns.id))
      .limit(1)
    if (!latest) return { runId: null, streamId: null, actions: [], nextCursor: null }
    const runId = latest.id
    const run = await requireAssistantRun(principal, { ...input, runId }, context.userId)
    const records = await db
      .select()
      .from(copilotAsyncToolCalls)
      .where(
        and(
          eq(copilotAsyncToolCalls.runId, runId),
          eq(copilotAsyncToolCalls.status, 'pending'),
          isNotNull(copilotAsyncToolCalls.assistantAction),
          isNotNull(copilotAsyncToolCalls.permissionRequestedAt),
          isNull(copilotAsyncToolCalls.permissionDecision),
          or(
            isNull(copilotAsyncToolCalls.executionDeadlineAt),
            gte(
              copilotAsyncToolCalls.executionDeadlineAt,
              new Date(Date.now() + SIM_TOOL_MIN_START_BUDGET_MS)
            )
          ),
          input.cursor === undefined
            ? undefined
            : gt(copilotAsyncToolCalls.persistSeq, input.cursor)
        )
      )
      .orderBy(asc(copilotAsyncToolCalls.persistSeq))
      .limit(33)
    const page = records.slice(0, 32)
    const actions = await Promise.all(
      page.map(async (record) => {
        const binding = record.assistantAction
        if (!binding) throw new Error('Assistant review is missing its binding')
        const account = await loadAssistantAccount({
          ...context,
          credentialId: binding.credentialId,
        })
        const tool = getToolMetadata(record.executableName ?? '')
        return {
          toolCallId: record.toolCallId,
          sequence: record.persistSeq,
          runId: record.runId,
          toolId: record.executableName ?? record.toolName,
          name: tool?.name ?? record.toolName,
          effect: binding.effect,
          account: account
            ? {
                credentialId: account.credentialId,
                displayName: account.displayName,
                providerId: account.providerId,
                active: account.active,
              }
            : null,
          proposalVersion: assistantProposalVersion(record),
          fields: assistantReviewFields(record),
        }
      })
    )
    return {
      ...run,
      actions,
      nextCursor: records.length > 32 ? (page.at(-1)?.persistSeq ?? null) : null,
    }
  },
})

interface DecisionInput extends ReviewInput {
  toolCallId: string
  proposalVersion: string
  decision: 'allow' | 'skip'
  edits?: Record<string, string>
}

export const decideOrganizationAssistantAction = defineAuthorizedOrganizationUseCase({
  operation: assistantActionOperations.decide,
  async execute({ principal, input, context }: OrganizationUseCaseContext<DecisionInput>) {
    await requireAssistantRun(principal, input, context.userId)
    const [proposal] = await db
      .select()
      .from(copilotAsyncToolCalls)
      .where(
        and(
          eq(copilotAsyncToolCalls.runId, input.runId),
          eq(copilotAsyncToolCalls.toolCallId, input.toolCallId)
        )
      )
      .limit(1)
    if (!proposal?.assistantAction)
      throw new OrchestrationError('not_found', 'Assistant action not found.')
    const scope = { ...context, credentialId: proposal.assistantAction.credentialId }
    return db.transaction(async (tx) => {
      if (input.decision === 'allow') await lockAssistantActionScope(scope, tx)
      else
        await acquireOrganizationUserMutationLocks(tx, {
          userId: scope.userId,
          organizationIds: [scope.organizationId],
        })
      await authorizeOrganizationOperation(principal, assistantActionOperations.decide, input, {
        executor: tx,
        forUpdate: true,
      })
      await requireAssistantRun(principal, input, context.userId, tx)
      await tx
        .select({ id: copilotRuns.id })
        .from(copilotRuns)
        .where(eq(copilotRuns.id, input.runId))
        .for('update')
      await requireAssistantRun(principal, input, context.userId, tx)
      const [record] = await tx
        .select()
        .from(copilotAsyncToolCalls)
        .where(
          and(
            eq(copilotAsyncToolCalls.runId, input.runId),
            eq(copilotAsyncToolCalls.toolCallId, input.toolCallId)
          )
        )
        .for('update')
        .limit(1)
      if (!record?.assistantAction || !record.executableName)
        throw new OrchestrationError('not_found', 'Assistant action not found.')
      if (assistantProposalVersion(record) !== input.proposalVersion)
        throw new OrchestrationError('conflict', 'This proposal changed. Refresh the review.')
      if (record.permissionDecision)
        return {
          toolCallId: record.toolCallId,
          decision: record.permissionDecision,
          applied: false,
        }
      if (
        record.status !== 'pending' ||
        !record.permissionRequestedAt ||
        record.executionStartedAt ||
        toolStartWindowClosed(record.executionDeadlineAt?.getTime(), Date.now())
      )
        throw new OrchestrationError('conflict', 'This action is no longer waiting for review.')
      const approvedArgs =
        input.decision === 'allow'
          ? applyAssistantReviewEdits(record, input.edits)
          : toRecord(record.args)
      if (input.decision === 'allow') {
        const current = await resolveAssistantActionPolicy(
          scope,
          { toolId: record.executableName, args: approvedArgs },
          tx
        )
        if (!isDeepStrictEqual(current.binding, record.assistantAction))
          throw new OrchestrationError(
            'conflict',
            'This operation changed. Ask Assistant to propose it again.'
          )
      }
      const decided = await recordToolPermissionDecision(input.toolCallId, input.decision, {
        approvedArgs,
        executor: tx,
      })
      if (!decided)
        throw new OrchestrationError('conflict', 'This action is no longer waiting for review.')
      return { toolCallId: record.toolCallId, decision: input.decision, applied: true }
    })
  },
  afterSuccess: ({ result }) => {
    if (result.applied)
      publishToolPermissionDecision({ toolCallId: result.toolCallId, decision: result.decision })
  },
  projectAudit: ({ input, result }) =>
    result.applied
      ? {
          action: AuditAction.ASSISTANT_ACTION_REVIEWED,
          resourceType: AuditResourceType.CHAT,
          resourceId: input.chatId,
          description: 'Reviewed an Assistant account action',
          metadata: { toolCallId: input.toolCallId, decision: result.decision, runId: input.runId },
        }
      : [],
})
