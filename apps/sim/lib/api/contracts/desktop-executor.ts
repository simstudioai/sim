import { z } from 'zod'
import { desktopToolCallIdSchema } from '@/lib/api/contracts/desktop-tool-authorization'
import { defineRouteContract } from '@/lib/api/contracts/types'

/**
 * The desktop background executor's wire protocol. The Electron main process calls every route
 * here with the cookie of the Better Auth session it registered under; Sim refuses any other
 * session for that device.
 */

/** The install id the desktop app generates once and keeps in its user data. */
const desktopDeviceIdSchema = z.string().uuid('Device ID must be a UUID')

const desktopDeviceCapabilitiesSchema = z.object({
  executor: z.number().int().min(1).max(1000),
  browser: z.boolean(),
  terminal: z.boolean(),
  localFiles: z.boolean(),
})

const registerDesktopDeviceBodySchema = z.object({
  deviceId: desktopDeviceIdSchema,
  name: z.string().trim().min(1, 'Device name is required').max(128, 'Device name is too long'),
  appVersion: z.string().trim().min(1, 'App version is required').max(64),
  platform: z.string().trim().min(1, 'Platform is required').max(64),
  capabilities: desktopDeviceCapabilitiesSchema,
})
export type RegisterDesktopDeviceBody = z.input<typeof registerDesktopDeviceBodySchema>

/**
 * `enabled: false` is the kill switch: the device keeps finishing calls on runs already bound to
 * it, but no new turn binds to it.
 */
export const registerDesktopDeviceResponseSchema = z.object({
  enabled: z.boolean(),
  protocolVersion: z.number().int().min(1),
  leaseMs: z.number().int().positive(),
  leaseRenewMs: z.number().int().positive(),
  reconcileMs: z.number().int().positive(),
})
export type RegisterDesktopDeviceResponse = z.output<typeof registerDesktopDeviceResponseSchema>

export const registerDesktopDeviceContract = defineRouteContract({
  method: 'POST',
  path: '/api/desktop/devices',
  body: registerDesktopDeviceBodySchema,
  response: { mode: 'json', schema: registerDesktopDeviceResponseSchema },
  error: z.object({ error: z.string() }),
})

const desktopInboxQuerySchema = z.object({ deviceId: desktopDeviceIdSchema })
export type DesktopInboxQuery = z.input<typeof desktopInboxQuerySchema>

const desktopInboxCallSchema = z.object({
  kind: z.literal('call'),
  toolCallId: desktopToolCallIdSchema,
  toolName: z.string().min(1),
  chatId: z.string().min(1),
  workspaceId: z.string().nullable(),
  createdAt: z.string(),
})

const desktopInboxApprovalSchema = z.object({
  kind: z.literal('approval_needed'),
  toolCallId: desktopToolCallIdSchema,
  toolName: z.string().min(1),
  chatId: z.string().min(1),
  chatTitle: z.string().nullable(),
  workspaceId: z.string().nullable(),
  /** A short description of what the call would do, such as the command to run. */
  summary: z.string().nullable(),
})

const desktopInboxCancelSchema = z.object({
  kind: z.literal('cancel'),
  toolCallId: desktopToolCallIdSchema,
})

/** Ordered by when each call was persisted, which is the order the executor claims them in. */
const desktopInboxItemSchema = z.discriminatedUnion('kind', [
  desktopInboxCallSchema,
  desktopInboxApprovalSchema,
  desktopInboxCancelSchema,
])
export type DesktopInboxItem = z.output<typeof desktopInboxItemSchema>

export const desktopInboxResponseSchema = z.object({
  items: z.array(desktopInboxItemSchema),
})
export type DesktopInboxResponse = z.output<typeof desktopInboxResponseSchema>

export const listDesktopInboxContract = defineRouteContract({
  method: 'GET',
  path: '/api/desktop/inbox',
  query: desktopInboxQuerySchema,
  response: { mode: 'json', schema: desktopInboxResponseSchema },
  error: z.object({ error: z.string() }),
})

/**
 * Server-sent events: `inbox_changed` with `{ reason: 'call' | 'approval' | 'cancel' }`, plus
 * heartbeat comments and a `rotate` event before the server closes a long-lived stream. Events
 * are hints; the device re-reads `GET /api/desktop/inbox` on each one. While the stream is open
 * the device counts as online.
 */
export const desktopInboxStreamContract = defineRouteContract({
  method: 'GET',
  path: '/api/desktop/inbox/stream',
  query: desktopInboxQuerySchema,
  response: { mode: 'stream' },
})

const claimDesktopToolBodySchema = z.object({
  deviceId: desktopDeviceIdSchema,
  toolCallId: desktopToolCallIdSchema,
})
export type ClaimDesktopToolBody = z.input<typeof claimDesktopToolBodySchema>

export const claimDesktopToolResponseSchema = z.object({
  toolName: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  chatId: z.string().min(1),
  workspaceId: z.string().nullable(),
  /** Presented on every lease renewal and on completion; it fences out stale owners. */
  executionToken: z.string().min(1),
})
export type ClaimDesktopToolResponse = z.output<typeof claimDesktopToolResponseSchema>

export const claimDesktopToolContract = defineRouteContract({
  method: 'POST',
  path: '/api/desktop/tool/claim',
  body: claimDesktopToolBodySchema,
  response: { mode: 'json', schema: claimDesktopToolResponseSchema },
  error: z.object({ error: z.string() }),
})

const renewDesktopToolLeaseBodySchema = z.object({
  deviceId: desktopDeviceIdSchema,
  toolCallId: desktopToolCallIdSchema,
  executionToken: z.string().min(1).max(128),
})
export type RenewDesktopToolLeaseBody = z.input<typeof renewDesktopToolLeaseBodySchema>

export const renewDesktopToolLeaseResponseSchema = z.object({ renewed: z.literal(true) })
export type RenewDesktopToolLeaseResponse = z.output<typeof renewDesktopToolLeaseResponseSchema>

/** A 410 means the call was stopped, settled, or its lease lapsed: cancel the local action. */
export const renewDesktopToolLeaseContract = defineRouteContract({
  method: 'POST',
  path: '/api/desktop/tool/lease',
  body: renewDesktopToolLeaseBodySchema,
  response: { mode: 'json', schema: renewDesktopToolLeaseResponseSchema },
  error: z.object({ error: z.string() }),
})

const completeDesktopToolBodySchema = z.object({
  deviceId: desktopDeviceIdSchema,
  toolCallId: desktopToolCallIdSchema,
  executionToken: z.string().min(1).max(128),
  status: z.enum(['success', 'error', 'cancelled']),
  message: z.string().max(10_000).optional(),
  data: z.unknown().optional(),
})
export type CompleteDesktopToolBody = z.input<typeof completeDesktopToolBodySchema>

/**
 * Every 200 is an acknowledgement the device's outbox can drop the result on. `recorded`: this
 * request settled the call. `duplicate`: an earlier request with the same token already did.
 * `superseded`: Sim settled the call first (Stop, or a lapsed lease), and `status` is what the
 * model received.
 */
export const completeDesktopToolResponseSchema = z.object({
  outcome: z.enum(['recorded', 'duplicate', 'superseded']),
  status: z.enum(['completed', 'failed', 'cancelled']),
})
export type CompleteDesktopToolResponse = z.output<typeof completeDesktopToolResponseSchema>

export const completeDesktopToolContract = defineRouteContract({
  method: 'POST',
  path: '/api/desktop/tool/complete',
  body: completeDesktopToolBodySchema,
  response: { mode: 'json', schema: completeDesktopToolResponseSchema },
  error: z.object({ error: z.string() }),
})
