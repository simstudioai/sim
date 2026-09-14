import { AsyncLocalStorage } from 'node:async_hooks'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { z } from 'zod'
import { getRedisClient } from '@/lib/core/config/redis'
import type { SimToolExecutionOwner } from '@/lib/mothership/async-runs/execution-lease'
import { isActiveSandboxResourceOwner } from '@/lib/mothership/async-runs/repository'
import { ResourcePayload } from '@/lib/mothership/generated/resources'
import type { StreamEvent } from '@/lib/mothership/request/types'
import { persistResourceEffect } from '@/lib/mothership/resources/persist-effect'
import { chatSandboxSessionKey } from '@/lib/mothership/tools/sandbox-session-key'

const logger = createLogger('MothershipSandboxResources')
const CONTEXT_TTL_SECONDS = 600
const POLL_MS = 200
const scopeSchema = z.object({
  toolCallId: z.string(),
  runId: z.string(),
  userId: z.string(),
  ownerToken: z.string(),
  chatId: z.string(),
  workspaceId: z.string(),
  apiKeyHash: z.string(),
})
type SandboxResourceScope = z.infer<typeof scopeSchema>

interface ActiveSandboxResourceScope {
  identity: SimToolExecutionOwner & { chatId: string; workspaceId: string }
  signal: AbortSignal
  token?: string
}

const resourceScope = new AsyncLocalStorage<ActiveSandboxResourceScope>()
const contextKey = (token: string) => `mothership:sandbox-resources:${token}:context`
const inboxKey = (token: string) => `mothership:sandbox-resources:${token}:inbox`
const seenKey = (token: string) => `mothership:sandbox-resources:${token}:seen`

function redisClient() {
  const redis = getRedisClient()
  if (!redis) throw new Error('Sandbox resource tracking requires Redis')
  return redis
}

/** Only the admitted in-process tool can bind an endpoint; arguments cannot select a chat. */
export async function sandboxResourceEndpoint(
  endpoint: string,
  args: { sessionKey: string; workspaceId: string; userId: string },
  apiKey: string
): Promise<string> {
  const active = resourceScope.getStore()
  if (!active) return endpoint
  active.signal.throwIfAborted()
  const identity = active.identity
  if (
    args.userId !== identity.userId ||
    args.workspaceId !== identity.workspaceId ||
    args.sessionKey !== chatSandboxSessionKey(identity.chatId) ||
    !(await isActiveSandboxResourceOwner(identity))
  )
    throw new Error('Sandbox resource scope does not match the active tool')
  const token = active.token ?? generateId()
  const scope: SandboxResourceScope = { ...identity, apiKeyHash: sha256Hex(apiKey) }
  await redisClient().set(contextKey(token), JSON.stringify(scope), 'EX', CONTEXT_TTL_SECONDS)
  active.token = token
  if (active.signal.aborted) {
    await redisClient().del(contextKey(token))
    active.signal.throwIfAborted()
  }
  return `${endpoint.replace(/\/$/, '')}/api/mothership/sandbox/${token}`
}

/** The opaque reference is scoped to a key and a live user/chat/tool lease, never an upstream URL. */
export async function readSandboxResourceScope(
  token: string,
  apiKey: string | null
): Promise<SandboxResourceScope | null> {
  if (!/^[0-9a-f-]{36}$/.test(token) || !apiKey) return null
  const raw = await redisClient().get(contextKey(token))
  if (!raw) return null
  const scope = scopeSchema.parse(JSON.parse(raw))
  if (scope.apiKeyHash !== sha256Hex(apiKey) || !(await isActiveSandboxResourceOwner(scope)))
    return null
  return scope
}

/** A successful mutation is never retried because its UI notification failed. */
export async function recordSandboxResourceEffects(
  token: string,
  scope: SandboxResourceScope,
  effects: ResourcePayload[]
): Promise<void> {
  if (!effects.length) return
  const warn = () => {
    logger.warn('Sandbox resource notification could not be recorded after the API response', {
      toolCallId: scope.toolCallId,
      chatId: scope.chatId,
    })
  }
  try {
    if (!(await isActiveSandboxResourceOwner(scope))) return
  } catch {
    warn()
    return
  }
  for (const effect of effects) {
    try {
      if (!(await redisClient().exists(contextKey(token)))) return
      await persistResourceEffect(scope.chatId, effect)
      await redisClient().eval(
        "if redis.call('exists', KEYS[1]) == 0 then return 0 end if redis.call('sadd', KEYS[3], ARGV[3]) == 0 then return 0 end redis.call('rpush', KEYS[2], ARGV[1]); redis.call('expire', KEYS[2], ARGV[2]); redis.call('expire', KEYS[3], ARGV[2]); return 1",
        3,
        contextKey(token),
        inboxKey(token),
        seenKey(token),
        JSON.stringify(effect),
        CONTEXT_TTL_SECONDS,
        effect.effectId ?? JSON.stringify(effect)
      )
    } catch {
      warn()
    }
  }
}

/** The existing controller drains notifications; headless calls persist the same effects without SSE. */
export async function withSandboxResourceScope<T>(
  identity: ActiveSandboxResourceScope['identity'],
  signal: AbortSignal,
  onEvent: ((event: StreamEvent) => void | Promise<void>) | undefined,
  execute: () => Promise<T>
): Promise<T> {
  const active: ActiveSandboxResourceScope = { identity, signal }
  const revoke = () => {
    if (active.token) {
      void (async () => {
        try {
          await redisClient().del(contextKey(active.token!))
        } catch {
          logger.warn('Sandbox resource scope revocation deferred to lease fencing', {
            toolCallId: identity.toolCallId,
          })
        }
      })()
    }
  }
  signal.addEventListener('abort', revoke, { once: true })
  const drain = async (all = false): Promise<boolean> => {
    if (!active.token || signal.aborted) return true
    try {
      const redis = redisClient()
      do {
        const entries = await redis.lrange(inboxKey(active.token), 0, 63)
        if (entries.length && !(await isActiveSandboxResourceOwner(identity))) return true
        for (const entry of entries) {
          if (signal.aborted) return true
          const payload = ResourcePayload.parse(JSON.parse(entry))
          await onEvent?.({ type: 'resource', payload })
          await redis.lpop(inboxKey(active.token))
        }
        if (entries.length < 64) break
      } while (all)
      return true
    } catch {
      logger.warn('Sandbox resource publication deferred', { toolCallId: identity.toolCallId })
      return false
    }
  }
  let running = true
  const execution = resourceScope
    .run(active, async () => execute())
    .finally(() => {
      running = false
    })
  const settled = execution.then(
    () => {},
    () => {}
  )
  try {
    while (running) {
      await Promise.race([settled, sleep(POLL_MS)])
      await drain()
    }
    return await execution
  } finally {
    signal.removeEventListener('abort', revoke)
    if (active.token) {
      try {
        await redisClient().del(contextKey(active.token))
        if (await drain(true)) await redisClient().del(inboxKey(active.token))
        await redisClient().del(seenKey(active.token))
      } catch {
        logger.warn('Sandbox resource scope cleanup deferred to expiry', {
          toolCallId: identity.toolCallId,
        })
      }
    }
  }
}
