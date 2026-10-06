import type { SessionPrincipal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isPlainRecord, omit } from '@sim/utils/object'
import { defineOperation } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedCredentialUserUseCase } from '@/lib/credentials/application/authorized-user-use-case'
import {
  DESKTOP_CALL_LEASE_RENEW_MS,
  DESKTOP_CALL_LEASE_SECONDS,
  DESKTOP_CALL_PICKUP_GRACE_MS,
  DESKTOP_EXECUTOR_PROTOCOL_VERSION,
  DESKTOP_INBOX_RECONCILE_MS,
  DESKTOP_PRESENCE_REFRESH_MS,
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
import {
  isDesktopPresent,
  markDesktopPresent,
  releaseDesktopPresence,
} from '@/lib/desktop/executor/presence'
import {
  acknowledgeDesktopCallResult,
  claimOfferedDesktopCall,
  getBindableDesktopDevice,
  getBoundDesktopCall,
  getBoundDesktopDevice,
  listDesktopActivityRows,
  listDesktopInboxRows,
  recordDesktopCallResult,
  renewDesktopCallLease,
  touchDesktopDevice,
  upsertDesktopDevice,
} from '@/lib/desktop/executor/repository'
import {
  desktopCallAwaitsApproval,
  desktopClaimOwner,
  isDesktopExecutorTool,
} from '@/lib/desktop/executor/tools'
import { resolveInvocationWorkspace } from '@/lib/mothership/application/workspace-target'
import { ASYNC_TOOL_STATUS } from '@/lib/mothership/async-runs/lifecycle'
import { publishToolConfirmation } from '@/lib/mothership/persistence/tool-confirm'
import {
  retainSealedClientToolContext,
  sealClientToolCompletion,
} from '@/lib/mothership/request/tools/client-completion-seal.server'

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
  const device = await getBindableDesktopDevice({
    deviceId,
    userId: principal.userId,
    sessionId: principal.sessionId,
  })
  if (!device) {
    logger.warn('Turn not bound: its desktop is not registered to this session', {
      userId: principal.userId,
      deviceId,
    })
    return null
  }
  return device.id
}

export interface RegisterDesktopDeviceInput extends DeviceInput {
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
          'This device ID belongs to another account. Generate a new device ID and register again.'
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
      leaseMs: DESKTOP_CALL_LEASE_SECONDS * 1000,
      leaseRenewMs: DESKTOP_CALL_LEASE_RENEW_MS,
      pickupGraceMs: DESKTOP_CALL_PICKUP_GRACE_MS,
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
    const identity = { deviceId: input.deviceId, userId: principal.userId }
    const [rows] = await Promise.all([
      listDesktopInboxRows(identity),
      touchDesktopDevice(input.deviceId),
    ])
    return { items: classifyDesktopInbox(rows) }
  },
})

type InboxSend = (eventName: string, data: Record<string, unknown>) => void

/**
 * Opens the doorbell for a device. While a stream is subscribed the device counts as online:
 * presence is written on connect, refreshed on a timer, and released when the stream closes.
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
    await requireBoundDevice(principal, input.deviceId)
    const { deviceId } = input
    return {
      revalidate: async () => {
        await requireBoundDevice(principal, deviceId)
      },
      subscribe: (send: InboxSend) => {
        const connectionId = generateId()
        const refreshPresence = () =>
          markDesktopPresent(deviceId, connectionId).catch((error) => {
            logger.warn('Desktop presence could not be refreshed', {
              deviceId,
              error: getErrorMessage(error),
            })
          })
        void refreshPresence()
        const refresh = setInterval(refreshPresence, DESKTOP_PRESENCE_REFRESH_MS)
        const unsubscribe = onDesktopInboxDoorbell(deviceId, (reason: DesktopInboxChangeReason) =>
          send('inbox_changed', { reason })
        )
        return () => {
          clearInterval(refresh)
          unsubscribe()
          void releaseDesktopPresence(deviceId, connectionId).catch((error) => {
            logger.warn('Desktop presence could not be released', {
              deviceId,
              error: getErrorMessage(error),
            })
          })
        }
      },
    }
  },
})

export interface ClaimDesktopToolInput extends DeviceInput {
  toolCallId: string
}

/**
 * Takes ownership of one offered call for this device and returns the server's canonical
 * arguments, never anything the device supplied, with the token that fences every later request.
 */
export const claimDesktopTool = defineAuthorizedCredentialUserUseCase({
  // permission-group-exempt: claims only calls Sim offered to this device for the user's own turns.
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
    const identity = { deviceId: input.deviceId, userId: principal.userId }
    const call = await getBoundDesktopCall(identity, input.toolCallId)
    if (!call) throw new OrchestrationError('not_found', 'Desktop tool call not found')
    const args = isPlainRecord(call.args) ? call.args : {}
    if (!isDesktopExecutorTool(call.toolName, args))
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
    const claim = await claimOfferedDesktopCall({
      toolCallId: call.toolCallId,
      runId: call.runId,
      userId: principal.userId,
      deviceId: input.deviceId,
      claimedBy: desktopClaimOwner(call.toolName),
      ownerToken: executionToken,
    })
    if (claim.outcome === 'closed')
      throw new OrchestrationError('conflict', 'This chat was stopped; do not run the call')
    if (claim.outcome === 'unavailable')
      throw new OrchestrationError('not_found', 'This call is no longer waiting for this device')
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
      leaseExpiresAt: claim.leaseExpiresAt,
    }
  },
})

export interface DesktopCallTokenInput extends DeviceInput {
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
    const leaseExpiresAt = await renewDesktopCallLease({
      toolCallId: input.toolCallId,
      userId: principal.userId,
      deviceId: input.deviceId,
      ownerToken: input.executionToken,
    })
    if (!leaseExpiresAt) throw new DesktopCallRevokedError()
    return { leaseExpiresAt }
  },
})

export interface CompleteDesktopToolInput extends DesktopCallTokenInput {
  status: 'success' | 'error' | 'cancelled'
  message?: string
  data?: unknown
}

const STOPPED_WHILE_RUNNING_MESSAGE =
  'Stopped by the user while the Sim desktop app was running this action. It may already have taken effect; inspect the current state before repeating it.'

const COMPLETION_STATUS = {
  success: { durable: ASYNC_TOOL_STATUS.completed, message: 'Tool completed' },
  error: { durable: ASYNC_TOOL_STATUS.failed, message: 'Tool failed' },
  cancelled: { durable: ASYNC_TOOL_STATUS.cancelled, message: 'Tool cancelled' },
} as const

/**
 * Records the device's result and wakes the run waiting on it. Idempotent per token: a retry of
 * a recorded result is a `duplicate`, and a result for a call Sim settled first is `superseded`.
 * The result is sealed to its run exactly as `/api/copilot/confirm` seals a renderer's result.
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
    const outcome = COMPLETION_STATUS[input.status]
    if (call.status === ASYNC_TOOL_STATUS.running) {
      const data = {
        ...retainSealedClientToolContext(call.result),
        ...(await sealClientToolCompletion({
          toolCallId: call.toolCallId,
          runId: call.runId,
          userId: principal.userId,
          ...(input.message !== undefined ? { message: input.message } : {}),
          ...(input.data !== undefined ? { data: input.data } : {}),
        })),
      }
      const recorded = await recordDesktopCallResult({
        toolCallId: call.toolCallId,
        runId: call.runId,
        ownerToken: input.executionToken,
        status: outcome.durable,
        result: data,
        error: input.status === 'success' ? null : outcome.message,
      })
      if (recorded) {
        publishToolConfirmation({
          toolCallId: call.toolCallId,
          status: input.status,
          message: outcome.message,
          timestamp: new Date().toISOString(),
          data,
        })
        logger.info('Desktop call completed', {
          userId: principal.userId,
          deviceId: input.deviceId,
          runId: call.runId,
          chatId: call.chatId,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          status: input.status,
        })
        return { outcome: 'recorded' as const, status: outcome.durable }
      }
    }
    const acknowledged = await acknowledgeDesktopCallResult({
      toolCallId: call.toolCallId,
      runId: call.runId,
      ownerToken: input.executionToken,
      stoppedMessage: STOPPED_WHILE_RUNNING_MESSAGE,
    })
    if (acknowledged.outcome === 'unknown')
      throw new OrchestrationError('not_found', 'Desktop tool call not found')
    return acknowledged
  },
})

export interface DesktopChatActivityEntry {
  chatId: string
  state: 'running' | 'needs_input' | 'blocked'
  deviceName: string
}

/**
 * Which of the caller's chats in a workspace are running on one of their desktops, and whether
 * each needs the user's approval or is blocked because that desktop is offline. Lists only the
 * caller's own runs, so it needs no workspace role; runs already bound keep showing after the
 * executor is turned off, until they end.
 */
export const listDesktopActivity = defineAuthorizedCredentialUserUseCase({
  // permission-group-exempt: reports only the caller's own runs, with no content.
  operation: defineOperation({
    id: 'desktop.executor.activity.list',
    principalKinds: ['session'],
    capability: 'none',
  }),
  async execute({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: { workspaceId: string }
  }): Promise<{ chats: DesktopChatActivityEntry[] }> {
    const runs = await listDesktopActivityRows({
      userId: principal.userId,
      workspaceId: input.workspaceId,
    })
    const devices = [...new Set(runs.map((run) => run.deviceId))]
    const online = new Map(
      await Promise.all(
        devices.map(
          async (deviceId) =>
            [deviceId, await isDesktopPresent(deviceId).catch(() => false)] as const
        )
      )
    )
    const chats = new Map<string, DesktopChatActivityEntry>()
    for (const run of runs) {
      if (chats.has(run.chatId)) continue
      const needsInput = run.waitingCalls.some((call) =>
        desktopCallAwaitsApproval(call.toolName, isPlainRecord(call.args) ? call.args : {})
      )
      chats.set(run.chatId, {
        chatId: run.chatId,
        deviceName: run.deviceName,
        state: needsInput ? 'needs_input' : online.get(run.deviceId) ? 'running' : 'blocked',
      })
    }
    return { chats: [...chats.values()] }
  },
})
