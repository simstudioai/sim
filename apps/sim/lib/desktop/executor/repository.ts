import { db } from '@sim/db'
import {
  type CopilotAsyncToolStatus,
  type CopilotRunStatus,
  copilotAsyncToolCalls,
  copilotChats,
  copilotRuns,
  desktopDevices,
} from '@sim/db/schema'
import { sanitizeValueForJsonb } from '@sim/utils/string'
import { and, asc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import {
  DESKTOP_CALL_LEASE_SECONDS,
  DESKTOP_INBOX_HORIZON_HOURS,
} from '@/lib/desktop/executor/constants'
import { DESKTOP_EXECUTOR_TOOL_NAMES } from '@/lib/desktop/executor/tools'
import { ASYNC_TOOL_STATUS, type AsyncCompletionData } from '@/lib/mothership/async-runs/lifecycle'

const TERMINAL_RUN_STATUSES: CopilotRunStatus[] = ['complete', 'error', 'cancelled']
const LIVE_RUN_STATUSES: CopilotRunStatus[] = ['active', 'paused_waiting_for_tool', 'resuming']
const INBOX_ROW_LIMIT = 500

const leaseFromNow = sql`clock_timestamp() + ${DESKTOP_CALL_LEASE_SECONDS} * interval '1 second'`

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
 * Registers the device under this session, replacing an older session of the same user and
 * clearing a revocation. Returns false when the install id already belongs to another user.
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
        revokedAt: null,
        lastSeenAt: sql`now()`,
        updatedAt: sql`now()`,
      },
      setWhere: eq(desktopDevices.userId, input.userId),
    })
    .returning({ id: desktopDevices.id })
  return Boolean(row)
}

export interface DesktopDeviceIdentity {
  deviceId: string
  userId: string
  sessionId: string
}

/** The device row only while it is bound to exactly this user and session and not revoked. */
export async function getBoundDesktopDevice(identity: DesktopDeviceIdentity) {
  const [row] = await db
    .select({
      id: desktopDevices.id,
      name: desktopDevices.name,
      capabilities: desktopDevices.capabilities,
    })
    .from(desktopDevices)
    .where(
      and(
        eq(desktopDevices.id, identity.deviceId),
        eq(desktopDevices.userId, identity.userId),
        eq(desktopDevices.sessionId, identity.sessionId),
        isNull(desktopDevices.revokedAt)
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
        sql`${desktopDevices.lastSeenAt} < now() - interval '1 minute'`
      )
    )
}

/**
 * The rows a device's inbox is built from: every pending desktop call on its recent open runs,
 * plus every call it claimed and has not yet acknowledged. Calls on stopped or ended runs that
 * nobody claimed are left out here, so they cannot crowd actionable rows past the limit. Ordered
 * by persistence time.
 */
export async function listDesktopInboxRows(identity: Omit<DesktopDeviceIdentity, 'sessionId'>) {
  return db
    .select({
      toolCallId: copilotAsyncToolCalls.toolCallId,
      toolName: copilotAsyncToolCalls.toolName,
      args: copilotAsyncToolCalls.args,
      status: copilotAsyncToolCalls.status,
      permissionDecision: copilotAsyncToolCalls.permissionDecision,
      claimed: sql<boolean>`${copilotAsyncToolCalls.executionOwnerToken} IS NOT NULL`,
      settled: sql<boolean>`${copilotAsyncToolCalls.executionSettledAt} IS NOT NULL`,
      revoked: sql<boolean>`${copilotAsyncToolCalls.executionRevokedAt} IS NOT NULL`,
      leaseLive: sql<boolean>`coalesce(${copilotAsyncToolCalls.executionLeaseExpiresAt} > clock_timestamp(), false)`,
      createdAt: copilotAsyncToolCalls.createdAt,
      chatId: copilotRuns.chatId,
      chatTitle: copilotChats.title,
      workspaceId: copilotRuns.workspaceId,
      runStatus: copilotRuns.status,
      admissionClosed: sql<boolean>`${copilotRuns.toolAdmissionClosedAt} IS NOT NULL`,
    })
    .from(copilotRuns)
    .innerJoin(copilotAsyncToolCalls, eq(copilotAsyncToolCalls.runId, copilotRuns.id))
    .innerJoin(copilotChats, eq(copilotChats.id, copilotRuns.chatId))
    .where(
      and(
        eq(copilotRuns.desktopDeviceId, identity.deviceId),
        eq(copilotRuns.userId, identity.userId),
        sql`${copilotRuns.startedAt} > now() - make_interval(hours => ${DESKTOP_INBOX_HORIZON_HOURS})`,
        inArray(copilotAsyncToolCalls.toolName, [...DESKTOP_EXECUTOR_TOOL_NAMES]),
        or(
          and(
            eq(copilotAsyncToolCalls.status, ASYNC_TOOL_STATUS.pending),
            inArray(copilotRuns.status, LIVE_RUN_STATUSES),
            isNull(copilotRuns.toolAdmissionClosedAt)
          ),
          and(
            isNotNull(copilotAsyncToolCalls.executionOwnerToken),
            isNull(copilotAsyncToolCalls.executionSettledAt)
          )
        )
      )
    )
    .orderBy(asc(copilotAsyncToolCalls.createdAt), asc(copilotAsyncToolCalls.toolCallId))
    .limit(INBOX_ROW_LIMIT)
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
      status: copilotAsyncToolCalls.status,
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

export type DesktopCallClaim =
  | { outcome: 'claimed'; leaseExpiresAt: Date }
  | { outcome: 'closed' }
  | { outcome: 'unavailable' }

/**
 * Claims an offered call for the device, serialized with Stop through the run row. Only a call
 * Sim has offered (pending, unowned, inside its pickup deadline) can be claimed, which is what
 * keeps a call held for approval, or one already failed as not started, out of reach.
 */
export async function claimOfferedDesktopCall(input: {
  toolCallId: string
  runId: string
  userId: string
  deviceId: string
  claimedBy: string
  ownerToken: string
}): Promise<DesktopCallClaim> {
  return db.transaction(async (tx) => {
    const [run] = await tx
      .select({
        status: copilotRuns.status,
        toolAdmissionClosedAt: copilotRuns.toolAdmissionClosedAt,
      })
      .from(copilotRuns)
      .where(
        and(
          eq(copilotRuns.id, input.runId),
          eq(copilotRuns.userId, input.userId),
          eq(copilotRuns.desktopDeviceId, input.deviceId)
        )
      )
      .for('update')
    if (!run || run.toolAdmissionClosedAt || TERMINAL_RUN_STATUSES.includes(run.status))
      return { outcome: 'closed' }
    const now = new Date()
    const [claimed] = await tx
      .update(copilotAsyncToolCalls)
      .set({
        status: ASYNC_TOOL_STATUS.running,
        claimedBy: input.claimedBy,
        claimedAt: now,
        executionOwnerToken: input.ownerToken,
        executionLeaseExpiresAt: leaseFromNow,
        updatedAt: now,
      })
      .where(
        and(
          eq(copilotAsyncToolCalls.toolCallId, input.toolCallId),
          eq(copilotAsyncToolCalls.runId, input.runId),
          eq(copilotAsyncToolCalls.status, ASYNC_TOOL_STATUS.pending),
          isNull(copilotAsyncToolCalls.executionOwnerToken),
          sql`${copilotAsyncToolCalls.executionLeaseExpiresAt} > clock_timestamp()`,
          or(
            isNull(copilotAsyncToolCalls.permissionDecision),
            ne(copilotAsyncToolCalls.permissionDecision, 'skip')
          )
        )
      )
      .returning({ leaseExpiresAt: copilotAsyncToolCalls.executionLeaseExpiresAt })
    if (!claimed?.leaseExpiresAt) return { outcome: 'unavailable' }
    return { outcome: 'claimed', leaseExpiresAt: claimed.leaseExpiresAt }
  })
}

/**
 * Extends the lease of a call this token still owns. An expired lease cannot be renewed, and
 * neither can a call whose run was stopped, so a renewal failure always means "stop the action".
 */
export async function renewDesktopCallLease(input: {
  toolCallId: string
  userId: string
  deviceId: string
  ownerToken: string
}): Promise<Date | null> {
  const [renewed] = await db
    .update(copilotAsyncToolCalls)
    .set({ executionLeaseExpiresAt: leaseFromNow })
    .where(
      and(
        eq(copilotAsyncToolCalls.toolCallId, input.toolCallId),
        eq(copilotAsyncToolCalls.status, ASYNC_TOOL_STATUS.running),
        eq(copilotAsyncToolCalls.executionOwnerToken, input.ownerToken),
        isNull(copilotAsyncToolCalls.executionSettledAt),
        isNull(copilotAsyncToolCalls.executionRevokedAt),
        sql`${copilotAsyncToolCalls.executionLeaseExpiresAt} > clock_timestamp()`,
        sql`EXISTS (SELECT 1 FROM ${copilotRuns} r WHERE r.id = ${copilotAsyncToolCalls.runId}
          AND r.user_id = ${input.userId} AND r.desktop_device_id = ${input.deviceId}
          AND r.tool_admission_closed_at IS NULL
          AND r.status NOT IN ('complete', 'error', 'cancelled'))`
      )
    )
    .returning({ leaseExpiresAt: copilotAsyncToolCalls.executionLeaseExpiresAt })
  return renewed?.leaseExpiresAt ?? null
}

type DesktopTerminalStatus = Extract<CopilotAsyncToolStatus, 'completed' | 'failed' | 'cancelled'>

/**
 * Records the device's result if its token still owns the running call and its run was not
 * stopped. A lapsed lease does not block it: until Sim settles the call as lost, a late but real
 * result is the better answer.
 */
export async function recordDesktopCallResult(input: {
  toolCallId: string
  runId: string
  ownerToken: string
  status: DesktopTerminalStatus
  result: AsyncCompletionData
  error: string | null
}): Promise<boolean> {
  const [row] = await db
    .update(copilotAsyncToolCalls)
    .set({
      status: input.status,
      result: sanitizeValueForJsonb(input.result),
      error: input.error,
      claimedBy: null,
      claimedAt: null,
      completedAt: sql`now()`,
      executionSettledAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(copilotAsyncToolCalls.toolCallId, input.toolCallId),
        eq(copilotAsyncToolCalls.runId, input.runId),
        eq(copilotAsyncToolCalls.status, ASYNC_TOOL_STATUS.running),
        eq(copilotAsyncToolCalls.executionOwnerToken, input.ownerToken),
        isNull(copilotAsyncToolCalls.executionRevokedAt),
        sql`EXISTS (SELECT 1 FROM ${copilotRuns} r WHERE r.id = ${copilotAsyncToolCalls.runId}
          AND r.tool_admission_closed_at IS NULL)`
      )
    )
    .returning({ toolCallId: copilotAsyncToolCalls.toolCallId })
  return Boolean(row)
}

export type DesktopCallAcknowledgement =
  | { outcome: 'duplicate' | 'superseded'; status: DesktopTerminalStatus }
  | { outcome: 'unknown' }

/**
 * Classifies a result that could not be recorded. A token whose own result is already recorded
 * is a duplicate; a token whose call Sim settled first is superseded, and acknowledging it here
 * removes the call's cancel item from the device's inbox. A call still running on a stopped run
 * is settled here as stopped: Stop is the answer the turn already received, whatever the device
 * reports.
 */
export async function acknowledgeDesktopCallResult(input: {
  toolCallId: string
  runId: string
  ownerToken: string
  stoppedMessage: string
}): Promise<DesktopCallAcknowledgement> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        status: copilotAsyncToolCalls.status,
        settled: sql<boolean>`${copilotAsyncToolCalls.executionSettledAt} IS NOT NULL`,
        revoked: sql<boolean>`${copilotAsyncToolCalls.executionRevokedAt} IS NOT NULL`,
        stopped: sql<boolean>`EXISTS (SELECT 1 FROM ${copilotRuns} r WHERE r.id = ${copilotAsyncToolCalls.runId}
          AND r.tool_admission_closed_at IS NOT NULL)`,
      })
      .from(copilotAsyncToolCalls)
      .where(
        and(
          eq(copilotAsyncToolCalls.toolCallId, input.toolCallId),
          eq(copilotAsyncToolCalls.runId, input.runId),
          eq(copilotAsyncToolCalls.executionOwnerToken, input.ownerToken)
        )
      )
      .for('update')
    if (!row) return { outcome: 'unknown' }
    if (row.status === ASYNC_TOOL_STATUS.running && row.stopped && !row.revoked) {
      await tx
        .update(copilotAsyncToolCalls)
        .set({
          status: ASYNC_TOOL_STATUS.cancelled,
          result: { error: input.stoppedMessage, outcomeUnknown: true, doNotRetry: true },
          error: input.stoppedMessage,
          claimedBy: null,
          claimedAt: null,
          completedAt: sql`now()`,
          executionSettledAt: sql`now()`,
          executionRevokedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(copilotAsyncToolCalls.toolCallId, input.toolCallId),
            eq(copilotAsyncToolCalls.executionOwnerToken, input.ownerToken)
          )
        )
      return { outcome: 'superseded', status: ASYNC_TOOL_STATUS.cancelled }
    }
    if (
      row.status !== ASYNC_TOOL_STATUS.completed &&
      row.status !== ASYNC_TOOL_STATUS.failed &&
      row.status !== ASYNC_TOOL_STATUS.cancelled
    )
      return { outcome: 'unknown' }
    if (row.settled && !row.revoked) return { outcome: 'duplicate', status: row.status }
    if (!row.settled) {
      await tx
        .update(copilotAsyncToolCalls)
        .set({
          executionSettledAt: sql`now()`,
          executionRevokedAt: sql`coalesce(${copilotAsyncToolCalls.executionRevokedAt}, now())`,
        })
        .where(
          and(
            eq(copilotAsyncToolCalls.toolCallId, input.toolCallId),
            eq(copilotAsyncToolCalls.executionOwnerToken, input.ownerToken)
          )
        )
    }
    return { outcome: 'superseded', status: row.status }
  })
}
