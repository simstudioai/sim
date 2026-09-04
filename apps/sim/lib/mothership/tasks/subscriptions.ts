/**
 * Copilot background tasks, sim side (mothership docs/revamp/21-background-tasks.md):
 * the worker owns a task and its delivery; sim owns the one mechanic that needs the
 * execution engine — knowing when a workflow run ends. A `watch` on a run writes a
 * subscription here; the logging session's completion posts the outcome back to the
 * worker's `/api/tasks/complete`, which claims it once and delivers the notification.
 */
import { copilotChats, copilotTaskSubscriptions, db, workflow } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq } from 'drizzle-orm'
import { fetchGo } from '@/lib/mothership/request/go/fetch'
import { mothershipRequestHeaders } from '@/lib/mothership/request/headers'
import { getMothershipBaseURL } from '@/lib/mothership/server/agent-url'

const logger = createLogger('CopilotTaskSubscriptions')

export async function subscribeTaskToExecution(input: {
  taskId: string
  executionId: string
  chatId: string
  workspaceId: string
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const [chat] = await db
    .select({ userId: copilotChats.userId, workspaceId: copilotChats.workspaceId })
    .from(copilotChats)
    .where(eq(copilotChats.id, input.chatId))
    .limit(1)
  if (!chat || chat.workspaceId !== input.workspaceId) {
    return { ok: false, status: 404, error: 'Chat not found in this workspace' }
  }
  await db
    .insert(copilotTaskSubscriptions)
    .values({
      taskId: input.taskId,
      executionId: input.executionId,
      chatId: input.chatId,
      workspaceId: input.workspaceId,
      userId: chat.userId,
    })
    .onConflictDoNothing()
  return { ok: true }
}

export type CompletedRunStatus = 'completed' | 'failed' | 'cancelled'

/**
 * Called from the execution logging session once a run's outcome is persisted. Every
 * subscription on the execution posts one completion to the worker and is deleted; a
 * failure to reach the worker keeps the row so the next completion attempt (the
 * session retries its own completion) can post again.
 */
export async function notifyWorkflowRunTasks(input: {
  executionId: string
  workflowId: string
  status: CompletedRunStatus
  error?: string | null
}): Promise<void> {
  const subscriptions = await db
    .select()
    .from(copilotTaskSubscriptions)
    .where(eq(copilotTaskSubscriptions.executionId, input.executionId))
  if (subscriptions.length === 0) return
  const [wf] = await db
    .select({ workspaceId: workflow.workspaceId, name: workflow.name })
    .from(workflow)
    .where(eq(workflow.id, input.workflowId))
    .limit(1)
  const taskStatus = input.status === 'completed' ? 'completed' : 'failed'
  const summary =
    input.status === 'completed'
      ? `Workflow run ${input.executionId} of "${wf?.name ?? input.workflowId}" completed`
      : input.status === 'cancelled'
        ? `Workflow run ${input.executionId} of "${wf?.name ?? input.workflowId}" was cancelled`
        : `Workflow run ${input.executionId} of "${wf?.name ?? input.workflowId}" failed${input.error ? `: ${input.error.slice(0, 500)}` : ''}`
  for (const sub of subscriptions) {
    // A subscription from another workspace than the run's is stale or forged: drop it silently.
    if (wf && wf.workspaceId !== sub.workspaceId) {
      await db.delete(copilotTaskSubscriptions).where(eq(copilotTaskSubscriptions.id, sub.id))
      continue
    }
    try {
      const baseUrl = await getMothershipBaseURL({ userId: sub.userId })
      const res = await fetchGo(`${baseUrl}/api/tasks/complete`, {
        method: 'POST',
        headers: mothershipRequestHeaders(),
        body: JSON.stringify({
          taskId: sub.taskId,
          status: taskStatus,
          summary,
          ...(input.error ? { output: input.error } : {}),
        }),
        spanName: 'copilot.tasks.complete',
      })
      if (!res.ok) {
        logger.warn('Worker refused a task completion; keeping the subscription', {
          taskId: sub.taskId,
          status: res.status,
        })
        continue
      }
      await db
        .delete(copilotTaskSubscriptions)
        .where(
          and(
            eq(copilotTaskSubscriptions.id, sub.id),
            eq(copilotTaskSubscriptions.taskId, sub.taskId)
          )
        )
    } catch (error) {
      logger.warn('Task completion post failed; keeping the subscription', {
        taskId: sub.taskId,
        error: getErrorMessage(error),
      })
    }
  }
}
