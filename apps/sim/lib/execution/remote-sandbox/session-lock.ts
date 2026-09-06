import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { createLogger } from '@sim/logger'
import { acquireLock, extendLock, releaseLock } from '@/lib/core/config/redis'

const logger = createLogger('SandboxSessionLock')
const localOwners = new Set<string>()
const LOCK_SECONDS = 180

/** Serializes session allocation and file access across replicas, leaving code executions parallel. */
export async function withSandboxSessionLock<T>(
  key: string,
  signal: AbortSignal,
  action: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  while (localOwners.has(key)) await delay(25, undefined, { signal })
  signal.throwIfAborted()
  localOwners.add(key)
  const lockKey = `sandbox-session:${key}`
  const owner = randomUUID()
  const lost = new AbortController()
  const leaseSignal = AbortSignal.any([signal, lost.signal])
  let acquired = false
  let heartbeat = Promise.resolve()
  let timer: ReturnType<typeof setInterval> | undefined
  try {
    while (!(await acquireLock(lockKey, owner, LOCK_SECONDS, { reclaimOnFailure: true }))) {
      await delay(100, undefined, { signal })
    }
    acquired = true
    leaseSignal.throwIfAborted()
    timer = setInterval(() => {
      heartbeat = heartbeat
        .then(async () => {
          if (!(await extendLock(lockKey, owner, LOCK_SECONDS))) {
            throw new Error('Sandbox session coordination lease expired')
          }
        })
        .catch((error: unknown) => lost.abort(error))
    }, 30_000)
    const result = await action(leaseSignal)
    leaseSignal.throwIfAborted()
    if (!(await extendLock(lockKey, owner, LOCK_SECONDS))) {
      throw new Error('Sandbox session coordination lease expired')
    }
    return result
  } finally {
    if (timer) clearInterval(timer)
    await heartbeat
    if (acquired) {
      await releaseLock(lockKey, owner).catch(() => {
        logger.warn('Sandbox session lock release failed; its lease will expire', { key })
      })
    }
    localOwners.delete(key)
  }
}
