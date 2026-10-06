import { AuditAction, type AuditActionType, AuditResourceType } from '@sim/audit'
import type { SessionPrincipal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { isPlainRecord, omit } from '@sim/utils/object'
import { defineOperation } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type CredentialUserAuditEntry,
  defineAuthorizedCredentialUserUseCase,
} from '@/lib/credentials/application/authorized-user-use-case'
import {
  DESKTOP_EXECUTOR_PROTOCOL_VERSION,
  DESKTOP_INBOX_RECONCILE_MS,
} from '@/lib/desktop/executor/constants'
import {
  type DesktopInboxChangeReason,
  onDesktopInboxDoorbell,
} from '@/lib/desktop/executor/doorbell'
import {
  DesktopCallRevokedError,
  DesktopDeviceUnrecognizedError,
} from '@/lib/desktop/executor/errors'
import { isDesktopBackgroundExecutorEnabled } from '@/lib/desktop/executor/flag'
import { classifyDesktopInbox, type DesktopInboxEntry } from '@/lib/desktop/executor/inbox'
import { markDesktopPresent } from '@/lib/desktop/executor/presence'
import {
  acknowledgeDesktopCallResult,
  getBoundDesktopCall,
  getBoundDesktopDevice,
  listDesktopInboxRows,
  touchDesktopDevice,
  upsertDesktopDevice,
} from '@/lib/desktop/executor/repository'
import { resolveInvocationWorkspace } from '@/lib/mothership/application/workspace-target'
import {
  SIM_TOOL_EXECUTION_HEARTBEAT_MS,
  SIM_TOOL_EXECUTION_LEASE_SECONDS,
} from '@/lib/mothership/async-runs/execution-lease'
import {
  claimDesktopToolCall,
  type DesktopToolCallClaim,
  renewSimToolExecutionLease,
} from '@/lib/mothership/async-runs/repository'
import { sealClientToolSettlement } from '@/lib/mothership/request/tools/client-completion-seal.server'
import {
  clientToolCompletionMessage,
  durableClientToolStatus,
  settleClientToolCall,
} from '@/lib/mothership/request/tools/client-settlement.server'
import {
  getDesktopExecutorClaimOwner,
  isDesktopToolCall,
} from '@/lib/mothership/tools/desktop-tools'

const logger = createLogger('DesktopExecutor')

type DeviceInput = { deviceId: string }

/** Every executor request must come from the session the device registered under. */
async function requireBoundDevice(principal: SessionPrincipal, deviceId: string) {
  const device = await getBoundDesktopDevice({
    deviceId,
    userId: principal.userId,
    sessionId: principal.sessionId,
  })
  if (!device) throw new DesktopDeviceUnrecognizedError()
  return device
}

/**
 * The device a new turn binds to: the composer's own, but only while the executor is on for this
 * user and the device is registered to this very session as an executor. Anything else leaves
 * the turn to the chat view, as before the executor existed.
 */
export async function resolveTurnDesktopDevice(
  principal: SessionPrincipal,
  deviceId: string
): Promise<string | null> {
  if (!(await isDesktopBackgroundExecutorEnabled(principal.userId))) return null
  const device = await getBoundDesktopDevice(
    { deviceId, userId: principal.userId, sessionId: principal.sessionId },
    { executor: true }
  )
  if (!device) {
    logger.warn('Turn not bound: its desktop is not registered to this session', {
      userId: principal.userId,
      deviceId,
    })
    return null
  }
  return device.id
}

interface RegisterDesktopDeviceInput extends DeviceInput {
  name: string
  appVersion: string
  platform: string
  capabilities: { executor: number; browser: boolean; terminal: boolean; localFiles: boolean }
}

/**
 * Binds the install to this user and session. With the executor turned off nothing is written,
 * and the device stays dormant.
 */
export const registerDesktopDevice = defineAuthorizedCredentialUserUseCase({
  // permission-group-exempt: registering grants no access; each call's run was admitted under the Chat capability.
  operation: defineOperation({
    id: 'desktop.executor.devices.register',
    principalKinds: ['session'],
    capability: 'none',
  }),
  async execute({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: RegisterDesktopDeviceInput
  }) {
    const enabled = await isDesktopBackgroundExecutorEnabled(principal.userId)
    if (enabled) {
      const registered = await upsertDesktopDevice({
        id: input.deviceId,
        userId: principal.userId,
        sessionId: principal.sessionId,
        name: input.name,
        appVersion: input.appVersion,
        platform: input.platform,
        capabilities: input.capabilities,
      })
      if (!registered)
        throw new OrchestrationError(
          'conflict',
          'This device ID belongs to another account or was revoked. Generate a new device ID and register again.'
        )
      logger.info('Desktop device registered', {
        userId: principal.userId,
        deviceId: input.deviceId,
        appVersion: input.appVersion,
        platform: input.platform,
      })
    }
    return {
      enabled,
      protocolVersion: DESKTOP_EXECUTOR_PROTOCOL_VERSION,
      leaseMs: SIM_TOOL_EXECUTION_LEASE_SECONDS * 1000,
      leaseRenewMs: SIM_TOOL_EXECUTION_HEARTBEAT_MS,
      reconcileMs: DESKTOP_INBOX_RECONCILE_MS,
    }
  },
})

/** The device's source of truth: re-read on connect, on every doorbell, and on its reconcile timer. */
export const listDesktopInbox = defineAuthorizedCredentialUserUseCase({
  // permission-group-exempt: lists only calls of the user's own turns bound to this device.
  operation: defineOperation({
    id: 'desktop.executor.inbox.list',
    principalKinds: ['session'],
    capability: 'none',
  }),
  async execute({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: DeviceInput
  }): Promise<{ items: DesktopInboxEntry[] }> {
    await requireBoundDevice(principal, input.deviceId)
    const [rows] = await Promise.all([
      listDesktopInboxRows({ deviceId: input.deviceId, userId: principal.userId }),
      markDesktopPresent(input.deviceId),
      touchDesktopDevice(input.deviceId),
    ])
    return { items: classifyDesktopInbox(rows) }
  },
})

type InboxSend = (eventName: string, data: Record<string, unknown>) => void

/**
 * Opens the doorbell for a device. Opening it counts as a device request for presence; the
 * stream's own lifetime does not, since a server cannot tell a sleeping device from a quiet one.
 * `revalidate` re-checks the device binding, so signing out ends a stream at its next heartbeat.
 */
export const openDesktopInboxStream = defineAuthorizedCredentialUserUseCase({
  // permission-group-exempt: carries only change hints for the user's own bound turns.
  operation: defineOperation({
    id: 'desktop.executor.inbox.stream',
    principalKinds: ['session'],
    capability: 'none',
  }),
  async execute({ principal, input }: { principal: SessionPrincipal; input: DeviceInput }) {
    const { deviceId } = input
    await requireBoundDevice(principal, deviceId)
    await markDesktopPresent(deviceId)
    return {
      revalidate: async () => {
        await requireBoundDevice(principal, deviceId)
      },
      subscribe: (send: InboxSend) =>
        onDesktopInboxDoorbell(deviceId, (reason: DesktopInboxChangeReason) =>
          send('inbox_changed', { reason })
        ),
    }
  },
})

interface AuditedDesktopCall {
  chatId: string
  workspaceId: string | null
  toolName: string
}

/** One audit entry per action the device takes on a chat's behalf; never its arguments or output. */
function desktopCallAudit(
  action: AuditActionType,
  input: { deviceId: string; toolCallId: string },
  call: AuditedDesktopCall,
  description: string
): CredentialUserAuditEntry {
  return {
    workspaceId: call.workspaceId,
    action,
    resourceType: AuditResourceType.DESKTOP_DEVICE,
    resourceId: input.deviceId,
    description,
    metadata: { toolCallId: input.toolCallId, toolName: call.toolName, chatId: call.chatId },
  }
}

/** Why the device may not take a call, as the error its claim answers with. */
function refusedClaim(
  outcome: Exclude<DesktopToolCallClaim['outcome'], 'claimed'>
): OrchestrationError {
  switch (outcome) {
    case 'closed':
      return new OrchestrationError('conflict', 'This chat turn ended or was stopped')
    case 'awaiting_permission':
      return new OrchestrationError('forbidden', 'The user has not approved this tool call')
    case 'existing':
      return new OrchestrationError('not_found', 'This call is no longer waiting for this device')
  }
}

interface ClaimDesktopToolInput extends DeviceInput {
  toolCallId: string
}

/**
 * Takes ownership of one pending call for this device and returns the server's canonical
 * arguments, never anything the device supplied, with the token that fences every later request.
 * The claim is the one Sim's own tools use, restricted to a pending call on a run bound to this
 * device that the user is not still being asked about.
 */
export const claimDesktopTool = defineAuthorizedCredentialUserUseCase({
  // permission-group-exempt: claims only calls of the user's own turns bound to this device.
  operation: defineOperation({
    id: 'desktop.executor.calls.claim',
    principalKinds: ['session'],
    capability: 'none',
  }),
  async execute({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: ClaimDesktopToolInput
  }) {
    await requireBoundDevice(principal, input.deviceId)
    const call = await getBoundDesktopCall(
      { deviceId: input.deviceId, userId: principal.userId },
      input.toolCallId
    )
    if (!call) throw new OrchestrationError('not_found', 'Desktop tool call not found')
    const args = isPlainRecord(call.args) ? call.args : {}
    if (!isDesktopToolCall(call.toolName, args))
      throw new OrchestrationError('forbidden', 'Tool call is not authorized for desktop execution')
    if (call.toolName === 'import_local_files') {
      if (typeof args.targetWorkspaceId !== 'string')
        throw new OrchestrationError('validation', 'A target workspace is required')
      await resolveInvocationWorkspace(
        {
          userId: principal.userId,
          chatId: call.chatId,
          workspaceId: call.workspaceId ?? undefined,
          organizationId: call.organizationId ?? undefined,
        },
        args.targetWorkspaceId
      )
    }
    const executionToken = generateId()
    const claim = await claimDesktopToolCall({
      toolCallId: call.toolCallId,
      runId: call.runId,
      userId: principal.userId,
      claimedBy: getDesktopExecutorClaimOwner(call.toolName),
      executor: { deviceId: input.deviceId, ownerToken: executionToken },
    })
    if (claim.outcome !== 'claimed') throw refusedClaim(claim.outcome)
    logger.info('Desktop call claimed', {
      userId: principal.userId,
      deviceId: input.deviceId,
      runId: call.runId,
      chatId: call.chatId,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
    })
    return {
      toolName: call.toolName,
      args: omit(args, ['activity']),
      chatId: call.chatId,
      workspaceId: call.workspaceId,
      executionToken,
    }
  },
  projectAudit: ({ input, result }) =>
    desktopCallAudit(
      AuditAction.DESKTOP_TOOL_CALL_CLAIMED,
      input,
      result,
      `Desktop started ${result.toolName} for a chat in the background`
    ),
})

interface DesktopCallTokenInput extends DeviceInput {
  toolCallId: string
  executionToken: string
}

/** Keeps a running call owned; failing here always means the device must stop the action. */
export const renewDesktopToolLease = defineAuthorizedCredentialUserUseCase({
  // permission-group-exempt: extends only a lease this device's token already holds.
  operation: defineOperation({
    id: 'desktop.executor.calls.renew',
    principalKinds: ['session'],
    capability: 'none',
  }),
  async execute({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: DesktopCallTokenInput
  }) {
    await requireBoundDevice(principal, input.deviceId)
    await markDesktopPresent(input.deviceId)
    const call = await getBoundDesktopCall(
      { deviceId: input.deviceId, userId: principal.userId },
      input.toolCallId
    )
    const renewed =
      call !== null &&
      (await renewSimToolExecutionLease(
        {
          toolCallId: call.toolCallId,
          runId: call.runId,
          userId: principal.userId,
          ownerToken: input.executionToken,
        },
        { deviceId: input.deviceId }
      ))
    if (!renewed) throw new DesktopCallRevokedError()
    return { renewed: true as const }
  },
})

interface CompleteDesktopToolInput extends DesktopCallTokenInput {
  status: 'success' | 'error' | 'cancelled'
  message?: string
  data?: unknown
}

/**
 * Records the device's result and wakes the run waiting on it, through the same sealing and
 * settlement `/api/copilot/confirm` uses. Idempotent per token: a retry of a recorded result is a
 * `duplicate`, and a result for a call Sim settled first is `superseded`.
 */
export const completeDesktopTool = defineAuthorizedCredentialUserUseCase({
  // permission-group-exempt: records a result only for a call this device's token owns.
  operation: defineOperation({
    id: 'desktop.executor.calls.complete',
    principalKinds: ['session'],
    capability: 'none',
  }),
  async execute({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: CompleteDesktopToolInput
  }) {
    await requireBoundDevice(principal, input.deviceId)
    const call = await getBoundDesktopCall(
      { deviceId: input.deviceId, userId: principal.userId },
      input.toolCallId
    )
    if (!call || call.ownerToken !== input.executionToken)
      throw new OrchestrationError('not_found', 'Desktop tool call not found')
    const settled = await settleClientToolCall({
      toolCallId: call.toolCallId,
      status: input.status,
      message: clientToolCompletionMessage(input.status),
      data: await sealClientToolSettlement(call.result, {
        toolCallId: call.toolCallId,
        runId: call.runId,
        userId: principal.userId,
        ...(input.message !== undefined ? { message: input.message } : {}),
        ...(input.data !== undefined ? { data: input.data } : {}),
      }),
      guard: { kind: 'owner', ownerToken: input.executionToken },
    })
    if (settled === 'updated') {
      logger.info('Desktop call completed', {
        userId: principal.userId,
        deviceId: input.deviceId,
        runId: call.runId,
        chatId: call.chatId,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        status: input.status,
      })
      return {
        outcome: 'recorded' as const,
        status: durableClientToolStatus(input.status),
        call: { chatId: call.chatId, workspaceId: call.workspaceId, toolName: call.toolName },
      }
    }
    const acknowledged = await acknowledgeDesktopCallResult({
      toolCallId: call.toolCallId,
      runId: call.runId,
      ownerToken: input.executionToken,
    })
    if (acknowledged.outcome === 'unknown')
      throw new OrchestrationError('not_found', 'Desktop tool call not found')
    return acknowledged
  },
  /** A duplicate or superseded result changed nothing, so only a recorded one is audited. */
  projectAudit: ({ input, result }) =>
    result.outcome === 'recorded'
      ? desktopCallAudit(
          AuditAction.DESKTOP_TOOL_CALL_COMPLETED,
          input,
          result.call,
          `Desktop reported ${result.call.toolName} as ${result.status}`
        )
      : [],
})
