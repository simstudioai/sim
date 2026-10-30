import { db } from '@sim/db'
import { copilotAsyncToolCalls, copilotChats, copilotRuns } from '@sim/db/schema'
import { truncateAtCodePoint } from '@sim/utils/string'
import { and, asc, eq, gt, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import type { AssistantActionReceiptsResponse } from '@/lib/api/contracts/assistant-actions'
import { assistantActionOperations } from '@/lib/assistant-actions/application/operations'
import { assistantReviewFields } from '@/lib/assistant-actions/proposal'
import { loadAssistantAccount } from '@/lib/assistant-actions/tool-permissions'
import {
  defineAuthorizedOrganizationUseCase,
  type OrganizationUseCaseContext,
} from '@/lib/core/application/authorized-organization-use-case'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { TERMINAL_RUN_STATUSES } from '@/lib/mothership/async-runs/repository'
import {
  requireOwnedChatReadable,
  resolveOwnedChatContext,
} from '@/lib/mothership/chat/application/context'
import { toolStartWindowClosed } from '@/lib/mothership/request/tools/deadline'
import { getToolMetadata } from '@/tools/metadata'

type ReceiptInput = { organizationId: string; chatId: string } & (
  | { streamId: string; cursor?: number }
  | { toolCallIds: string[] }
)
type ReceiptState = AssistantActionReceiptsResponse['receipts'][number]['state']

const receiptColumns = {
  toolCallId: copilotAsyncToolCalls.toolCallId,
  runId: copilotAsyncToolCalls.runId,
  streamId: copilotRuns.streamId,
  currentStreamId: copilotChats.conversationId,
  runStatus: copilotRuns.status,
  closedAt: copilotRuns.toolAdmissionClosedAt,
  executableName: copilotAsyncToolCalls.executableName,
  toolName: copilotAsyncToolCalls.toolName,
  args: sql<unknown>`coalesce(${copilotAsyncToolCalls.approvedArgs}, ${copilotAsyncToolCalls.args})`,
  binding: copilotAsyncToolCalls.assistantAction,
  status: copilotAsyncToolCalls.status,
  decision: copilotAsyncToolCalls.permissionDecision,
  requestedAt: copilotAsyncToolCalls.permissionRequestedAt,
  decidedAt: copilotAsyncToolCalls.permissionDecidedAt,
  completedAt: copilotAsyncToolCalls.completedAt,
  persistSeq: copilotAsyncToolCalls.persistSeq,
  startedAt: copilotAsyncToolCalls.executionStartedAt,
  settledAt: copilotAsyncToolCalls.executionSettledAt,
  revokedAt: copilotAsyncToolCalls.executionRevokedAt,
  leaseExpiresAt: copilotAsyncToolCalls.executionLeaseExpiresAt,
  deadlineAt: copilotAsyncToolCalls.executionDeadlineAt,
  outcomeUnknown: sql<boolean>`coalesce(${copilotAsyncToolCalls.result}->'outcomeUnknown' = 'true'::jsonb, false) or coalesce(${copilotAsyncToolCalls.result}#>'{output,outcomeUnknown}' = 'true'::jsonb, false)`,
  warning: sql<
    string | null
  >`case when ${copilotAsyncToolCalls.executableName} = 'jira_write' then left(${copilotAsyncToolCalls.result}#>>'{output,warning}', 2048) else null end`,
}

/** History remains readable after a turn closes; it never grants authority to execute it. */
export const listOrganizationAssistantActionReceipts = defineAuthorizedOrganizationUseCase({
  operation: assistantActionOperations.receipts,
  async authorizeResource({ principal, input, context }: OrganizationUseCaseContext<ReceiptInput>) {
    const chat = await resolveOwnedChatContext(principal, input.chatId)
    if (chat.organizationId !== context.organizationId || chat.mode !== 'assistant')
      throw new OrchestrationError('not_found', 'Chat not found')
    await requireOwnedChatReadable(chat)
  },
  async execute({
    input,
    context,
  }: OrganizationUseCaseContext<ReceiptInput>): Promise<AssistantActionReceiptsResponse> {
    const records = await db
      .select(receiptColumns)
      .from(copilotAsyncToolCalls)
      .innerJoin(copilotRuns, eq(copilotRuns.id, copilotAsyncToolCalls.runId))
      .innerJoin(copilotChats, eq(copilotChats.id, copilotRuns.chatId))
      .where(
        and(
          eq(copilotRuns.chatId, input.chatId),
          eq(copilotRuns.organizationId, context.organizationId),
          eq(copilotRuns.userId, context.userId),
          eq(copilotChats.organizationId, context.organizationId),
          eq(copilotChats.userId, context.userId),
          isNull(copilotChats.deletedAt),
          isNotNull(copilotAsyncToolCalls.assistantAction),
          or(
            isNotNull(copilotAsyncToolCalls.permissionRequestedAt),
            sql`${copilotAsyncToolCalls.assistantAction}->>'effect' = 'write'`
          ),
          'streamId' in input
            ? eq(copilotRuns.streamId, input.streamId)
            : inArray(copilotAsyncToolCalls.toolCallId, input.toolCallIds),
          'cursor' in input && input.cursor !== undefined
            ? gt(copilotAsyncToolCalls.persistSeq, input.cursor)
            : undefined
        )
      )
      .orderBy(asc(copilotAsyncToolCalls.persistSeq))
      .limit(33)
    const page = records.slice(0, 32)
    const credentialIds = [
      ...new Set(page.flatMap((record) => (record.binding ? [record.binding.credentialId] : []))),
    ]
    const accounts = new Map(
      await Promise.all(
        credentialIds.map(
          async (credentialId) =>
            [credentialId, await loadAssistantAccount({ ...context, credentialId })] as const
        )
      )
    )
    const now = Date.now()
    const receipts = page.flatMap((record) => {
      if (!record.binding) return []
      const account = accounts.get(record.binding.credentialId)
      const toolId = record.executableName ?? record.toolName
      const tool = getToolMetadata(toolId)
      const detailsAvailable = Boolean(
        tool?.assistant && tool.assistant.version === record.binding.operationVersion
      )
      const running =
        !record.settledAt &&
        !record.revokedAt &&
        record.leaseExpiresAt !== null &&
        record.leaseExpiresAt.getTime() > now
      const closed =
        record.closedAt !== null ||
        TERMINAL_RUN_STATUSES.includes(record.runStatus) ||
        record.currentStreamId !== record.streamId ||
        toolStartWindowClosed(record.deadlineAt?.getTime(), now)
      let state: ReceiptState
      if (record.status === 'completed') state = 'succeeded'
      else if (
        record.outcomeUnknown ||
        (record.startedAt && record.revokedAt) ||
        (record.startedAt && record.status === 'cancelled')
      )
        state = 'uncertain'
      else if (record.decision === 'skip' || record.status === 'cancelled') state = 'cancelled'
      else if (record.status === 'failed') state = 'failed'
      else if (running) state = 'running'
      else if (record.startedAt || record.status === 'delivered') state = 'uncertain'
      else if (closed) state = 'cancelled'
      else state = record.decision || record.requestedAt === null ? 'approved' : 'pending'
      return [
        {
          toolCallId: record.toolCallId,
          sequence: record.persistSeq,
          runId: record.runId,
          streamId: record.streamId,
          toolId,
          name: tool?.name ?? record.toolName,
          effect: record.binding.effect,
          state,
          unsettled:
            running ||
            state === 'approved' ||
            state === 'pending' ||
            (!closed &&
              !record.settledAt &&
              !record.revokedAt &&
              ['pending', 'running', 'delivered'].includes(record.status)),
          decision: record.decision,
          decidedAt: record.decidedAt?.toISOString() ?? null,
          completedAt: record.completedAt?.toISOString() ?? null,
          detailsAvailable,
          warning: record.warning === null ? null : truncateAtCodePoint(record.warning, 2048, ''),
          account: account
            ? {
                credentialId: account.credentialId,
                displayName: account.displayName,
                providerId: account.providerId,
                active: account.active,
              }
            : null,
          fields: detailsAvailable ? assistantReviewFields(record) : [],
        },
      ]
    })
    return { receipts, nextCursor: records.length > 32 ? (page.at(-1)?.persistSeq ?? null) : null }
  },
})
