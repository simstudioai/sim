import { type ExternalMailerRestriction, parseExternalMailerRestriction } from '@sim/auth/principal'
import { copilotRuns, db, mothershipInboxAllowedSender, mothershipInboxTask, user } from '@sim/db'
import { generateId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const admissionSchema = z
  .strictObject({
    version: z.literal(1),
    admissionId: z.string().min(1),
    inboxTaskId: z.string().min(1),
    workspaceId: z.string().min(1),
    executionUserId: z.string().min(1),
    memberUserId: z.string().min(1).nullable(),
  })
  .refine(
    (admission) =>
      admission.memberUserId === null || admission.executionUserId === admission.memberUserId,
    'Member admission must execute as its sender'
  )

export type InboxAdmission = z.infer<typeof admissionSchema>

/** An admitted external sender never gains member authority while a queued task waits. */
export async function admitInboxTask(input: {
  taskId: string
  senderEmail: string
  workspaceId: string
  ownerId: string
  existing?: unknown
}): Promise<InboxAdmission> {
  const current = await resolveSender(input.senderEmail, input.workspaceId)
  if (!current.allowed) throw new Error('Sender is no longer eligible for this inbox')
  if (input.existing != null) {
    const saved = admissionSchema.parse(input.existing)
    if (saved.inboxTaskId !== input.taskId || saved.workspaceId !== input.workspaceId)
      throw new Error('Inbox admission scope mismatch')
    if (saved.memberUserId && saved.memberUserId !== current.memberUserId)
      throw new Error('Admitted sender no longer has workspace access')
    if (!saved.memberUserId && saved.executionUserId !== input.ownerId)
      throw new Error('Inbox execution owner changed')
    return saved
  }
  return {
    version: 1,
    admissionId: generateId(),
    inboxTaskId: input.taskId,
    workspaceId: input.workspaceId,
    executionUserId: current.memberUserId ?? input.ownerId,
    memberUserId: current.memberUserId,
  }
}

export function inboxExecutionRestriction(
  admission: InboxAdmission
): ExternalMailerRestriction | undefined {
  if (admission.memberUserId) return undefined
  return parseExternalMailerRestriction({
    version: 1,
    kind: 'external_mailer',
    admissionId: admission.admissionId,
    inboxTaskId: admission.inboxTaskId,
    workspaceId: admission.workspaceId,
  })
}

async function resolveSender(email: string, workspaceId: string) {
  const [matched] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = ${email.toLowerCase()}`)
    .orderBy(user.createdAt)
    .limit(1)
  if (matched && (await getUserEntityPermissions(matched.id, 'workspace', workspaceId)))
    return { allowed: true, memberUserId: matched.id }
  const [allowed] = await db
    .select({ id: mothershipInboxAllowedSender.id })
    .from(mothershipInboxAllowedSender)
    .where(
      and(
        eq(mothershipInboxAllowedSender.workspaceId, workspaceId),
        eq(mothershipInboxAllowedSender.email, email.toLowerCase())
      )
    )
    .limit(1)
  return { allowed: Boolean(allowed), memberUserId: null }
}

/** Restores authority from the task and run, never callback-supplied permission flags. */
export async function restoreInboxRestriction(input: {
  userId: string
  chatId?: string
  workspaceId?: string
  organizationId?: string
  streamId?: string
}): Promise<ExternalMailerRestriction | undefined> {
  if (!input.chatId) throw new Error('Tool callbacks require a conversation binding')
  const [boundRun] = input.streamId
    ? await db
        .select({
          context: copilotRuns.requestContext,
          chatId: copilotRuns.chatId,
          workspaceId: copilotRuns.workspaceId,
          organizationId: copilotRuns.organizationId,
          status: copilotRuns.status,
        })
        .from(copilotRuns)
        .where(and(eq(copilotRuns.userId, input.userId), eq(copilotRuns.streamId, input.streamId)))
        .limit(1)
    : []
  if (
    input.streamId &&
    (!boundRun ||
      boundRun.chatId !== input.chatId ||
      (boundRun.workspaceId ?? undefined) !== input.workspaceId ||
      (boundRun.organizationId ?? undefined) !== input.organizationId)
  )
    throw new Error('Callback does not match its admitted run')
  const tasks = await db
    .select({ admission: mothershipInboxTask.executionAdmission })
    .from(mothershipInboxTask)
    .where(eq(mothershipInboxTask.chatId, input.chatId))
    .limit(2)
  if (tasks.length === 0) {
    if (toRecord(boundRun?.context).executionRestriction)
      throw new Error('External Mailer task is unavailable')
    return undefined
  }
  const admissions = tasks.map((task) => admissionSchema.parse(task.admission))
  const restricted = admissions.find((admission) => !admission.memberUserId)
  if (!restricted) return undefined
  if (
    tasks.length !== 1 ||
    !input.streamId ||
    input.organizationId ||
    input.workspaceId !== restricted.workspaceId ||
    input.userId !== restricted.executionUserId
  )
    throw new Error('External Mailer callback binding is invalid')
  const run = boundRun
  if (
    !run ||
    run.chatId !== input.chatId ||
    run.workspaceId !== input.workspaceId ||
    !['active', 'paused_waiting_for_tool', 'resuming'].includes(run.status)
  )
    throw new Error('External Mailer run is unavailable')
  const policy = parseExternalMailerRestriction(toRecord(run.context).executionRestriction)
  if (
    policy.admissionId !== restricted.admissionId ||
    policy.inboxTaskId !== restricted.inboxTaskId ||
    policy.workspaceId !== restricted.workspaceId
  )
    throw new Error('External Mailer admission mismatch')
  return policy
}
