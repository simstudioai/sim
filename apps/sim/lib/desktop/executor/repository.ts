import { db } from '@sim/db'
import {
  type CopilotRunStatus,
  copilotAsyncToolCalls,
  copilotChats,
  copilotRuns,
  desktopDevices,
} from '@sim/db/schema'
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { DESKTOP_INBOX_HORIZON_HOURS } from '@/lib/desktop/executor/constants'
import { ASYNC_TOOL_STATUS, isTerminalAsyncStatus } from '@/lib/mothership/async-runs/lifecycle'
import { DESKTOP_TOOL_CALL_NAMES } from '@/lib/mothership/tools/desktop-tools'

const LIVE_RUN_STATUSES: CopilotRunStatus[] = ['active', 'paused_waiting_for_tool', 'resuming']
const INBOX_ROW_LIMIT = 500

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
    .select({ id: desktopDevices.id })
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
 * The rows a device's inbox is built from: every unclaimed pending desktop call on its recent open
 * runs, plus every call it claimed and has not yet acknowledged. Pending calls on stopped or ended
 * runs are left out here, so they cannot crowd actionable rows past the limit. Ordered by
 * persistence time, the order the device claims in.
 */
export async function listDesktopInboxRows(identity: Omit<DesktopDeviceIdentity, 'sessionId'>) {
  return db
    .select({
      toolCallId: copilotAsyncToolCalls.toolCallId,
      toolName: copilotAsyncToolCalls.toolName,
      args: copilotAsyncToolCalls.args,
      status: copilotAsyncToolCalls.status,
      permissionRequestedAt: copilotAsyncToolCalls.permissionRequestedAt,
      permissionDecision: copilotAsyncToolCalls.permissionDecision,
      claimed: sql<boolean>`${copilotAsyncToolCalls.executionOwnerToken} IS NOT NULL`,
      createdAt: copilotAsyncToolCalls.createdAt,
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
        inArray(copilotAsyncToolCalls.toolName, [...DESKTOP_TOOL_CALL_NAMES]),
        or(
          and(
            eq(copilotAsyncToolCalls.status, ASYNC_TOOL_STATUS.pending),
            isNull(copilotAsyncToolCalls.executionOwnerToken),
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
