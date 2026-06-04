import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { getRedisClient } from '@/lib/core/config/redis'

const logger = createLogger('WebhookPendingVerification')

const DEFAULT_TTL_SECONDS = 120
const REDIS_KEY_PREFIX = 'webhook:pending-verification:'

const inMemoryPendingVerificationStore = new Map<string, PendingWebhookVerification>()

export interface PendingWebhookVerification {
  path: string
  provider: string
  workflowId?: string
  blockId?: string
  metadata?: Record<string, unknown>
  expiresAt: number
}

export interface PendingWebhookVerificationRegistration {
  path: string
  provider: string
  workflowId?: string
  blockId?: string
  metadata?: Record<string, unknown>
  ttlSeconds?: number
}

interface PendingWebhookVerificationProbe {
  method: string
  body: Record<string, unknown> | undefined
}

type PendingWebhookVerificationRegistrationMatcher = (
  registration: PendingWebhookVerificationRegistration
) => boolean

type PendingWebhookVerificationProbeMatcher = (
  probe: PendingWebhookVerificationProbe,
  entry: PendingWebhookVerification
) => boolean

const pendingWebhookVerificationRegistrationMatchers: Record<
  string,
  PendingWebhookVerificationRegistrationMatcher
> = {
  ashby: () => true,
  grain: () => true,
  generic: (registration) => registration.metadata?.verifyTestEvents === true,
  salesforce: () => true,
}

const pendingWebhookVerificationProbeMatchers: Record<
  string,
  PendingWebhookVerificationProbeMatcher
> = {
  ashby: ({ method, body }) => method === 'POST' && body?.action === 'ping',
  grain: ({ method, body }) =>
    method === 'GET' ||
    method === 'HEAD' ||
    (method === 'POST' && (!body || Object.keys(body).length === 0 || !body.type)),
  generic: ({ method, body }) =>
    method === 'GET' ||
    method === 'HEAD' ||
    (method === 'POST' && (!body || Object.keys(body).length === 0)),
  salesforce: ({ method, body }) =>
    method === 'GET' ||
    method === 'HEAD' ||
    (method === 'POST' && (!body || Object.keys(body).length === 0)),
}

function getRedisKey(path: string): string {
  return `${REDIS_KEY_PREFIX}${path}`
}

function isExpired(entry: PendingWebhookVerification): boolean {
  return entry.expiresAt <= Date.now()
}

function getInMemoryPendingWebhookVerification(path: string): PendingWebhookVerification | null {
  const entry = inMemoryPendingVerificationStore.get(path)
  if (!entry) {
    return null
  }

  if (isExpired(entry)) {
    inMemoryPendingVerificationStore.delete(path)
    return null
  }

  return entry
}

export function requiresPendingWebhookVerification(
  provider: string,
  metadata?: Record<string, unknown>
): boolean {
  const registrationMatcher = pendingWebhookVerificationRegistrationMatchers[provider]
  if (!registrationMatcher) {
    return false
  }

  return registrationMatcher({
    path: '',
    provider,
    metadata,
  })
}

export async function registerPendingWebhookVerification(
  registration: PendingWebhookVerificationRegistration
): Promise<void> {
  const registrationMatcher = pendingWebhookVerificationRegistrationMatchers[registration.provider]
  if (!registrationMatcher || !registrationMatcher(registration)) {
    return
  }

  const ttlSeconds = registration.ttlSeconds ?? DEFAULT_TTL_SECONDS
  const entry: PendingWebhookVerification = {
    path: registration.path,
    provider: registration.provider,
    workflowId: registration.workflowId,
    blockId: registration.blockId,
    metadata: registration.metadata,
    expiresAt: Date.now() + ttlSeconds * 1000,
  }

  const redis = getRedisClient()
  if (redis) {
    await redis.set(getRedisKey(registration.path), JSON.stringify(entry), 'EX', ttlSeconds)
  } else {
    inMemoryPendingVerificationStore.set(registration.path, entry)
  }

  logger.info('Registered pending webhook verification', {
    provider: registration.provider,
    path: registration.path,
    ttlSeconds,
  })
}

export async function getPendingWebhookVerification(
  path: string
): Promise<PendingWebhookVerification | null> {
  const redis = getRedisClient()
  if (redis) {
    const value = await redis.get(getRedisKey(path))
    if (!value) {
      return null
    }

    try {
      const entry = JSON.parse(value) as PendingWebhookVerification
      if (isExpired(entry)) {
        await redis.del(getRedisKey(path))
        return null
      }
      return entry
    } catch (error) {
      logger.warn('Failed to parse pending webhook verification entry', {
        path,
        error: toError(error).message,
      })
      await redis.del(getRedisKey(path))
      return null
    }
  }

  return getInMemoryPendingWebhookVerification(path)
}

export async function clearPendingWebhookVerification(path: string): Promise<void> {
  const redis = getRedisClient()
  if (redis) {
    await redis.del(getRedisKey(path))
  } else {
    inMemoryPendingVerificationStore.delete(path)
  }

  logger.info('Cleared pending webhook verification', { path })
}

export function matchesPendingWebhookVerificationProbe(
  entry: PendingWebhookVerification,
  probe: PendingWebhookVerificationProbe
): boolean {
  const matcher = pendingWebhookVerificationProbeMatchers[entry.provider]
  if (!matcher) {
    return false
  }

  return matcher(probe, entry)
}

export class PendingWebhookVerificationTracker {
  private readonly registeredPaths = new Set<string>()

  async register(registration: PendingWebhookVerificationRegistration): Promise<void> {
    const registrationMatcher =
      pendingWebhookVerificationRegistrationMatchers[registration.provider]
    if (!registrationMatcher || !registrationMatcher(registration)) {
      return
    }

    await registerPendingWebhookVerification(registration)
    this.registeredPaths.add(registration.path)
  }

  async clear(path: string): Promise<void> {
    if (!this.registeredPaths.has(path)) {
      return
    }

    await clearPendingWebhookVerification(path)
    this.registeredPaths.delete(path)
  }

  async clearAll(): Promise<void> {
    for (const path of this.registeredPaths) {
      await clearPendingWebhookVerification(path)
    }

    this.registeredPaths.clear()
  }
}
