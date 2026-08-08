import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type CursorKey, INVALID_CURSOR_MESSAGE } from '@/lib/api/list-query'
import { updateRunStatus } from '@/lib/copilot/async-runs/repository'
import { ChatRunProgressUnavailableError } from '@/lib/copilot/chat/application/errors'
import { chatOperations } from '@/lib/copilot/chat/application/operations'
import { ChatActivityProjector, type V2ChatActivity } from '@/lib/copilot/chat/public-activity'
import {
  getPersistedPublicChatRunResponse,
  getPublicChatRun,
  listPublicChatRuns,
  type PublicChatRunRow,
} from '@/lib/copilot/chat/public-runs'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
  MothershipStreamV1TextChannel,
} from '@/lib/copilot/generated/mothership-stream-v1'
import { publicChatUsageLimitMessage } from '@/lib/copilot/headless/workspace-chat'
import { eventToStreamEvent, readEvents } from '@/lib/copilot/request/session'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { isAuthDisabled } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

const logger = createLogger('CopilotChatRunsApplication')
const TERMINAL_RUN_STATUSES = new Set<PublicChatRunRow['status']>([
  'complete',
  'error',
  'cancelled',
])

async function loadWorkspaceContext(workspaceId: string) {
  const context = await loadActiveWorkspaceApplicationContext(workspaceId)
  if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
  /**
   * DISABLE_AUTH's synthetic principal is not a personal API key. Preserve the
   * self-host policy while still requiring its current workspace permission.
   */
  return isAuthDisabled ? { ...context, allowPersonalApiKeys: true } : context
}

export interface ListChatRunsInput {
  workspaceId: string
  status?: PublicChatRunRow['status']
  limit: number
  cursorKeys?: CursorKey[]
}

export interface ListChatRunsResult {
  rows: PublicChatRunRow[]
  hasMore: boolean
}

export const listChatRuns = defineAuthorizedWorkspaceUseCase({
  operation: chatOperations.listRuns,
  resolveContext: ({ input }: { input: ListChatRunsInput }) =>
    loadWorkspaceContext(input.workspaceId),
  authorizationOptions: {},
  execute: async ({ principal, input, context }): Promise<ListChatRunsResult> => {
    const result = await listPublicChatRuns({
      userId: principal.userId,
      workspaceId: context.workspaceId,
      status: input.status,
      limit: input.limit,
      cursorKeys: input.cursorKeys,
    })
    if (result.status === 'invalid_cursor') {
      throw new OrchestrationError('validation', INVALID_CURSOR_MESSAGE)
    }
    return {
      rows: result.rows.slice(0, input.limit),
      hasMore: result.rows.length > input.limit,
    }
  },
})

interface PublicRunSnapshot {
  response: string
  activities: V2ChatActivity[]
  replayStatus?: PublicChatRunRow['status']
  replayCompletedAt?: Date
}

async function persistedFallback(run: PublicChatRunRow): Promise<string> {
  const response = (await getPersistedPublicChatRunResponse(run.chatId, run.streamId)) ?? ''
  return publicChatUsageLimitMessage(response) ? '' : response
}

async function buildPublicRunSnapshot(run: PublicChatRunRow): Promise<PublicRunSnapshot | null> {
  let envelopes
  try {
    envelopes = await readEvents(run.streamId, '0')
  } catch (error) {
    logger.warn('Failed to read chat run replay; using safe fallback', {
      runId: run.runId,
      error: getErrorMessage(error, 'Unknown error'),
    })
    return TERMINAL_RUN_STATUSES.has(run.status)
      ? { response: await persistedFallback(run), activities: [] }
      : null
  }

  if (envelopes.length === 0 || envelopes.some((envelope, index) => envelope.seq !== index + 1)) {
    return TERMINAL_RUN_STATUSES.has(run.status)
      ? { response: await persistedFallback(run), activities: [] }
      : null
  }

  const projector = new ChatActivityProjector()
  const activities: V2ChatActivity[] = []
  const rootText: string[] = []
  let completionStatus: 'complete' | 'error' | undefined
  let replayStatus: PublicChatRunRow['status'] | undefined
  let replayCompletedAt: Date | undefined

  for (const envelope of envelopes) {
    const event = eventToStreamEvent(envelope)
    activities.push(...projector.project(event))

    if (
      event.type === MothershipStreamV1EventType.text &&
      event.payload.channel === MothershipStreamV1TextChannel.assistant &&
      !event.scope &&
      event.payload.text &&
      !publicChatUsageLimitMessage(event.payload.text)
    ) {
      rootText.push(event.payload.text)
    }

    if (event.type === MothershipStreamV1EventType.complete && !event.scope) {
      replayStatus =
        event.payload.status === MothershipStreamV1CompletionStatus.complete
          ? 'complete'
          : event.payload.status === MothershipStreamV1CompletionStatus.cancelled
            ? 'cancelled'
            : 'error'
      replayCompletedAt = new Date(envelope.ts)
      completionStatus = replayStatus === 'complete' ? 'complete' : 'error'
    }
  }

  if (!completionStatus && TERMINAL_RUN_STATUSES.has(run.status)) {
    completionStatus = run.status === 'complete' ? 'complete' : 'error'
  }
  if (completionStatus) activities.push(...projector.finish(completionStatus))

  const accumulated = rootText.join('')
  const response =
    accumulated.length === 0 && (replayStatus || TERMINAL_RUN_STATUSES.has(run.status))
      ? await persistedFallback(run)
      : accumulated
  return {
    response: publicChatUsageLimitMessage(response) ? '' : response,
    activities,
    ...(replayStatus ? { replayStatus, replayCompletedAt } : {}),
  }
}

export interface ReadChatRunInput {
  runId: string
  workspaceId: string
}

export interface ReadChatRunResult {
  run: PublicChatRunRow
  status: PublicChatRunRow['status']
  completedAt: Date | null
  response: string
  activities: V2ChatActivity[]
}

export const readChatRun = defineAuthorizedWorkspaceUseCase({
  operation: chatOperations.readRun,
  resolveContext: ({ input }: { input: ReadChatRunInput }) =>
    loadWorkspaceContext(input.workspaceId),
  authorizationOptions: {},
  execute: async ({ principal, input, context }): Promise<ReadChatRunResult> => {
    const run = await getPublicChatRun({
      runId: input.runId,
      userId: principal.userId,
      workspaceId: context.workspaceId,
    })
    if (!run) throw new OrchestrationError('not_found', 'Chat run not found')

    const snapshot = await buildPublicRunSnapshot(run)
    if (!snapshot) throw new ChatRunProgressUnavailableError()

    const status = snapshot.replayStatus ?? run.status
    const completedAt = snapshot.replayCompletedAt ?? run.completedAt
    if (snapshot.replayStatus && (run.status !== snapshot.replayStatus || !run.completedAt)) {
      try {
        await updateRunStatus(run.runId, snapshot.replayStatus, {
          completedAt: snapshot.replayCompletedAt ?? new Date(),
        })
      } catch (error) {
        logger.warn('Failed to reconcile chat run status from terminal replay', {
          runId: run.runId,
          error: getErrorMessage(error, 'Unknown error'),
        })
      }
    }

    return {
      run,
      status,
      completedAt,
      response: snapshot.response,
      activities: snapshot.activities,
    }
  },
})
