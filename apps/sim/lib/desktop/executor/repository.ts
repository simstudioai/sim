import { db } from '@sim/db'
import {
  type CopilotRunStatus,
  copilotAsyncToolCalls,
  copilotChats,
  copilotRuns,
  desktopDevices,
} from '@sim/db/schema'
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import {
  DESKTOP_INBOX_HORIZON_HOURS,
  DESKTOP_LAST_SEEN_WRITE_SECONDS,
  DESKTOP_PRESENCE_TTL_SECONDS,
} from '@/lib/desktop/executor/constants'
import {
  ASYNC_TOOL_STATUS,
  DESKTOP_TOOL_CLAIM_OWNER,
  EXECUTABLE_TOOL_PERMISSION_DECISIONS,
  isTerminalAsyncStatus,
} from '@/lib/mothership/async-runs/lifecycle'
import { DESKTOP_TOOL_PICKUP_GRACE_MS } from '@/lib/mothership/constants'
import { NAMED_DESKTOP_TOOL_NAMES } from '@/lib/mothership/tools/desktop-tools'
import { USER_LOCAL_VFS_ROOT } from '@/lib/mothership/tools/local-filesystem'

const LIVE_RUN_STATUSES: CopilotRunStatus[] = ['active', 'paused_waiting_for_tool', 'resuming']

/** A call held for the user's decision: asked about (or answered) and not allowed. */
const awaitingPermission = and(
  or(
    isNotNull(copilotAsyncToolCalls.permissionRequestedAt),
    isNotNull(copilotAsyncToolCalls.permissionDecision)
  ),
  or(
    isNull(copilotAsyncToolCalls.permissionDecision),
    notInArray(copilotAsyncToolCalls.permissionDecision, [...EXECUTABLE_TOOL_PERMISSION_DECISIONS])
  )
)

/**
 * When an unclaimed call on a bound run must be picked up by: its offer's deadline, or, for a call
 * Sim never got to offer (its process died first), one pickup window after it could first run.
 */
const pickupDeadline = sql`coalesce(${copilotAsyncToolCalls.pickupDeadlineAt}, coalesce(${copilotAsyncToolCalls.permissionDecidedAt}, ${copilotAsyncToolCalls.createdAt}) + ${DESKTOP_TOOL_PICKUP_GRACE_MS} * interval '1 millisecond')`

/** An unclaimed call that may run and whose pickup deadline passed `at`. */
function pickupOverdueAt(at: SQL) {
  return and(
    eq(copilotAsyncToolCalls.status, ASYNC_TOOL_STATUS.pending),
    sql`NOT (${awaitingPermission})`,
    sql`${pickupDeadline} <= ${at}`
  )
}

function isUserLocalVfsPath(path: SQL) {
  return sql`(${path} = ${USER_LOCAL_VFS_ROOT} OR ${path} LIKE ${`${USER_LOCAL_VFS_ROOT}/%`})`
}

/**
 * The SQL form of `isDesktopToolCall`, so a query limits only over calls the desktop runs: a
 * desktop tool by name, or a VFS read of a granted local folder (not a read of Sim's own files).
 */
const isDesktopToolCallRow = or(
  inArray(copilotAsyncToolCalls.toolName, [...NAMED_DESKTOP_TOOL_NAMES]),
  and(
    inArray(copilotAsyncToolCalls.toolName, ['read', 'grep']),
    isUserLocalVfsPath(sql`${copilotAsyncToolCalls.args}->>'path'`)
  ),
  and(
    eq(copilotAsyncToolCalls.toolName, 'glob'),
    isUserLocalVfsPath(sql`${copilotAsyncToolCalls.args}->>'pattern'`)
  )
)
const INBOX_ROW_LIMIT = 500

/**
 * Persistence order, which follows the order the model emitted the calls in: calls of one turn
 * can share a millisecond, so the timestamp alone cannot order them. Rows persisted before the
 * sequence existed have none and come first, as they are the oldest.
 */
function persistOrder() {
  return [
    sql`${copilotAsyncToolCalls.persistSeq} ASC NULLS FIRST`,
    asc(copilotAsyncToolCalls.createdAt),
    asc(copilotAsyncToolCalls.toolCallId),
  ]
}

export interface DesktopDeviceRegistration {
  id: string
  userId: string
  sessionId: string
  name: string
  appVersion: string
  platform: string
  capabilities: Record<string, unknown>
}

/**
 * Registers the device under this session, replacing an older session of the same user. Returns
 * false when the install id belongs to another user or was revoked: a revoked id is retired, so
 * registering it again cannot undo the revocation, and the device starts over with a new id.
 */
export async function upsertDesktopDevice(input: DesktopDeviceRegistration): Promise<boolean> {
  const [row] = await db
    .insert(desktopDevices)
    .values({
      id: input.id,
      userId: input.userId,
      sessionId: input.sessionId,
      name: input.name,
      appVersion: input.appVersion,
      platform: input.platform,
      capabilities: input.capabilities,
    })
    .onConflictDoUpdate({
      target: desktopDevices.id,
      set: {
        sessionId: input.sessionId,
        name: input.name,
        appVersion: input.appVersion,
        platform: input.platform,
        capabilities: input.capabilities,
        lastSeenAt: sql`now()`,
        updatedAt: sql`now()`,
      },
      setWhere: and(eq(desktopDevices.userId, input.userId), isNull(desktopDevices.revokedAt)),
    })
    .returning({ id: desktopDevices.id })
  return Boolean(row)
}

export interface DesktopDeviceIdentity {
  deviceId: string
  userId: string
  sessionId: string
}

/**
 * The device row only while it is bound to exactly this user and session and not revoked. With
 * `executor`, only a device that registered a background executor a turn can be bound to.
 */
export async function getBoundDesktopDevice(
  identity: DesktopDeviceIdentity,
  options: { executor?: boolean } = {}
) {
  const [row] = await db
    .select({ id: desktopDevices.id })
    .from(desktopDevices)
    .where(
      and(
        eq(desktopDevices.id, identity.deviceId),
        eq(desktopDevices.userId, identity.userId),
        eq(desktopDevices.sessionId, identity.sessionId),
        isNull(desktopDevices.revokedAt),
        options.executor
          ? sql`coalesce((${desktopDevices.capabilities} ->> 'executor')::int, 0) >= 1`
          : undefined
      )
    )
    .limit(1)
  return row ?? null
}

/** Display and support only; written at most once a minute per device. */
export async function touchDesktopDevice(deviceId: string): Promise<void> {
  await db
    .update(desktopDevices)
    .set({ lastSeenAt: sql`now()` })
    .where(
      and(
        eq(desktopDevices.id, deviceId),
        sql`${desktopDevices.lastSeenAt} < now() - ${DESKTOP_LAST_SEEN_WRITE_SECONDS} * interval '1 second'`
      )
    )
}

/**
 * The rows a device's inbox is built from, in two sets with their own limits so neither can crowd
 * out the other: unclaimed calls on its recent open runs that are offered or waiting for the
 * user's decision, and calls it claimed that Sim settled without its result and it has not yet
 * acknowledged (cancel items). A call the device is still running is never listed: it already
 * holds it. Ordered by persistence, the order the device claims in.
 */
export async function listDesktopInboxRows(identity: Omit<DesktopDeviceIdentity, 'sessionId'>) {
  const rowsWhere = (state: SQL | undefined) =>
    db
      .select({
        toolCallId: copilotAsyncToolCalls.toolCallId,
        toolName: copilotAsyncToolCalls.toolName,
        args: copilotAsyncToolCalls.args,
        status: copilotAsyncToolCalls.status,
        permissionRequestedAt: copilotAsyncToolCalls.permissionRequestedAt,
        permissionDecision: copilotAsyncToolCalls.permissionDecision,
        claimed: sql<boolean>`${copilotAsyncToolCalls.executionOwnerToken} IS NOT NULL`,
        createdAt: copilotAsyncToolCalls.createdAt,
        persistSeq: copilotAsyncToolCalls.persistSeq,
        chatId: copilotRuns.chatId,
        chatTitle: copilotChats.title,
        workspaceId: copilotRuns.workspaceId,
      })
      .from(copilotRuns)
      .innerJoin(copilotAsyncToolCalls, eq(copilotAsyncToolCalls.runId, copilotRuns.id))
      .innerJoin(copilotChats, eq(copilotChats.id, copilotRuns.chatId))
      .where(
        and(
          eq(copilotRuns.desktopDeviceId, identity.deviceId),
          eq(copilotRuns.userId, identity.userId),
          sql`${copilotRuns.startedAt} > now() - make_interval(hours => ${DESKTOP_INBOX_HORIZON_HOURS})`,
          isDesktopToolCallRow,
          state
        )
      )
      .orderBy(...persistOrder())
      .limit(INBOX_ROW_LIMIT)
  return rowsWhere(
    and(
      eq(copilotAsyncToolCalls.status, ASYNC_TOOL_STATUS.pending),
      isNull(copilotAsyncToolCalls.executionOwnerToken),
      or(sql`${copilotAsyncToolCalls.pickupDeadlineAt} > clock_timestamp()`, awaitingPermission),
      inArray(copilotRuns.status, LIVE_RUN_STATUSES),
      isNull(copilotRuns.toolAdmissionClosedAt)
    )
  )
    .unionAll(
      rowsWhere(
        and(
          isNotNull(copilotAsyncToolCalls.executionOwnerToken),
          isNull(copilotAsyncToolCalls.executionSettledAt),
          ne(copilotAsyncToolCalls.status, ASYNC_TOOL_STATUS.running)
        )
      )
    )
    .orderBy(...persistOrder())
}

export type DesktopInboxRow = Awaited<ReturnType<typeof listDesktopInboxRows>>[number]

/** A call and the run it belongs to, only when that run is bound to this device and user. */
export async function getBoundDesktopCall(
  identity: Omit<DesktopDeviceIdentity, 'sessionId'>,
  toolCallId: string
) {
  const [row] = await db
    .select({
      toolCallId: copilotAsyncToolCalls.toolCallId,
      toolName: copilotAsyncToolCalls.toolName,
      args: copilotAsyncToolCalls.args,
      result: copilotAsyncToolCalls.result,
      ownerToken: copilotAsyncToolCalls.executionOwnerToken,
      runId: copilotRuns.id,
      chatId: copilotRuns.chatId,
      workspaceId: copilotRuns.workspaceId,
      organizationId: copilotRuns.organizationId,
    })
    .from(copilotAsyncToolCalls)
    .innerJoin(copilotRuns, eq(copilotRuns.id, copilotAsyncToolCalls.runId))
    .where(
      and(
        eq(copilotAsyncToolCalls.toolCallId, toolCallId),
        eq(copilotRuns.desktopDeviceId, identity.deviceId),
        eq(copilotRuns.userId, identity.userId)
      )
    )
    .limit(1)
  return row ?? null
}

type DesktopTerminalStatus = 'completed' | 'failed' | 'cancelled'

export type DesktopCallAcknowledgement =
  | { outcome: 'duplicate' | 'superseded'; status: DesktopTerminalStatus }
  | { outcome: 'unknown' }

/**
 * Classifies a result that could not be recorded because the call is already settled. A token
 * whose own result was recorded (it settled the execution without a revocation) is a duplicate.
 * Otherwise Sim settled the call first, as Stop or a lost lease does, and the result is
 * superseded; marking the execution settled acknowledges the cancellation, which removes the
 * call's cancel item from the device's inbox.
 */
export async function acknowledgeDesktopCallResult(input: {
  toolCallId: string
  runId: string
  ownerToken: string
}): Promise<DesktopCallAcknowledgement> {
  return db.transaction(async (tx) => {
    const owned = and(
      eq(copilotAsyncToolCalls.toolCallId, input.toolCallId),
      eq(copilotAsyncToolCalls.runId, input.runId),
      eq(copilotAsyncToolCalls.executionOwnerToken, input.ownerToken)
    )
    const [row] = await tx
      .select({
        status: copilotAsyncToolCalls.status,
        settled: sql<boolean>`${copilotAsyncToolCalls.executionSettledAt} IS NOT NULL`,
        revoked: sql<boolean>`${copilotAsyncToolCalls.executionRevokedAt} IS NOT NULL`,
      })
      .from(copilotAsyncToolCalls)
      .where(owned)
      .for('update')
    if (!row || !isTerminalAsyncStatus(row.status)) return { outcome: 'unknown' }
    if (row.settled && !row.revoked) return { outcome: 'duplicate', status: row.status }
    if (!row.settled) {
      await tx
        .update(copilotAsyncToolCalls)
        .set({
          executionSettledAt: sql`now()`,
          executionRevokedAt: sql`coalesce(${copilotAsyncToolCalls.executionRevokedAt}, now())`,
        })
        .where(owned)
    }
    return { outcome: 'superseded', status: row.status }
  })
}

/** The device a run's desktop calls are bound to, or null for a run the chat view serves. */
export async function getRunDesktopDeviceId(runId: string): Promise<string | null> {
  const [row] = await db
    .select({ desktopDeviceId: copilotRuns.desktopDeviceId })
    .from(copilotRuns)
    .where(eq(copilotRuns.id, runId))
    .limit(1)
  return row?.desktopDeviceId ?? null
}

/**
 * Offers a pending call on a bound run to its device by opening its pickup window. Only an
 * unclaimed call the user is not still deciding on can be offered, and only once, so a
 * re-dispatched call keeps its first deadline; recording the user's decision clears it, so an
 * allowed call's window starts when it is offered after the answer.
 */
export async function offerDesktopToolCall(input: {
  toolCallId: string
  runId: string
  pickupGraceMs: number
}): Promise<boolean> {
  const [row] = await db
    .update(copilotAsyncToolCalls)
    .set({
      pickupDeadlineAt: sql`clock_timestamp() + ${input.pickupGraceMs} * interval '1 millisecond'`,
    })
    .where(
      and(
        eq(copilotAsyncToolCalls.toolCallId, input.toolCallId),
        eq(copilotAsyncToolCalls.runId, input.runId),
        eq(copilotAsyncToolCalls.status, ASYNC_TOOL_STATUS.pending),
        isNull(copilotAsyncToolCalls.pickupDeadlineAt),
        sql`NOT (${awaitingPermission})`,
        sql`EXISTS (SELECT 1 FROM ${copilotRuns} r WHERE r.id = ${copilotAsyncToolCalls.runId} AND r.desktop_device_id IS NOT NULL)`
      )
    )
    .returning({ toolCallId: copilotAsyncToolCalls.toolCallId })
  return Boolean(row)
}

/**
 * A bound desktop call with the deadlines only Sim enforces, read on the database clock every CAS
 * uses: whether its pickup window closed while it is unclaimed, and whether its lease lapsed while
 * it runs. Null for a call on a run no device is bound to, and for a tool the desktop never runs.
 */
export async function getDesktopToolCallDeadlines(toolCallId: string) {
  const [row] = await db
    .select({
      toolCallId: copilotAsyncToolCalls.toolCallId,
      toolName: copilotAsyncToolCalls.toolName,
      args: copilotAsyncToolCalls.args,
      runId: copilotRuns.id,
      userId: copilotRuns.userId,
      deviceId: copilotRuns.desktopDeviceId,
      status: copilotAsyncToolCalls.status,
      ownerToken: copilotAsyncToolCalls.executionOwnerToken,
      result: copilotAsyncToolCalls.result,
      pickupOverdue: sql<boolean>`coalesce(${pickupOverdueAt(sql`clock_timestamp()`)}, false)`,
      leaseLapsed: sql<boolean>`coalesce(${copilotAsyncToolCalls.executionLeaseExpiresAt} <= clock_timestamp(), false)`,
      /**
       * Whether the device's pulls show it awake, independently of Redis presence: a pull writes
       * `last_seen_at` at most once per write interval, so a device seen within the presence TTL
       * plus that interval may still be pulling even when its presence key is missing.
       */
      recentlySeen: sql<boolean>`coalesce(${desktopDevices.lastSeenAt} > clock_timestamp() - ${DESKTOP_PRESENCE_TTL_SECONDS + DESKTOP_LAST_SEEN_WRITE_SECONDS} * interval '1 second', false)`,
    })
    .from(copilotAsyncToolCalls)
    .innerJoin(copilotRuns, eq(copilotRuns.id, copilotAsyncToolCalls.runId))
    .leftJoin(desktopDevices, eq(desktopDevices.id, copilotRuns.desktopDeviceId))
    .where(
      and(
        eq(copilotAsyncToolCalls.toolCallId, toolCallId),
        isNotNull(copilotRuns.desktopDeviceId),
        isDesktopToolCallRow
      )
    )
    .limit(1)
  return row?.deviceId ? { ...row, deviceId: row.deviceId } : null
}

export type DesktopToolCallDeadlines = NonNullable<
  Awaited<ReturnType<typeof getDesktopToolCallDeadlines>>
>

/**
 * Bound desktop calls a deadline passed for at least `slackMs` ago: unclaimed past their pickup
 * deadline (offered or not), or claimed by the executor with a lapsed lease. A live waiter settles
 * these within its 5 s poll, so anything this finds lost its waiter. The scan starts from the
 * few unsettled calls (pending or running), in persistence order, so however long a call stayed
 * overdue it is still reached.
 */
export async function listOverdueDesktopToolCalls(input: { slackMs: number; limit: number }) {
  const overdue = sql`clock_timestamp() - ${input.slackMs} * interval '1 millisecond'`
  const rows = await db
    .select({ toolCallId: copilotAsyncToolCalls.toolCallId })
    .from(copilotAsyncToolCalls)
    .innerJoin(copilotRuns, eq(copilotRuns.id, copilotAsyncToolCalls.runId))
    .where(
      and(
        isNotNull(copilotRuns.desktopDeviceId),
        isDesktopToolCallRow,
        or(
          pickupOverdueAt(overdue),
          and(
            eq(copilotAsyncToolCalls.status, ASYNC_TOOL_STATUS.running),
            inArray(copilotAsyncToolCalls.claimedBy, Object.values(DESKTOP_TOOL_CLAIM_OWNER)),
            isNotNull(copilotAsyncToolCalls.executionOwnerToken),
            isNull(copilotAsyncToolCalls.executionRevokedAt),
            sql`${copilotAsyncToolCalls.executionLeaseExpiresAt} < ${overdue}`
          )
        )
      )
    )
    .orderBy(...persistOrder())
    .limit(input.limit)
  return rows.map((row) => row.toolCallId)
}
