import { createLogger } from '@sim/logger'
import { getRedisClient } from '@/lib/core/config/redis'
import type { WorkspaceDispatchStorageAdapter } from '@/lib/core/workspace-dispatch/adapter'
import { MemoryWorkspaceDispatchStorage } from '@/lib/core/workspace-dispatch/memory-store'
import { RedisWorkspaceDispatchStorage } from '@/lib/core/workspace-dispatch/redis-store'

const logger = createLogger('WorkspaceDispatchFactory')

let cachedAdapter: WorkspaceDispatchStorageAdapter | null = null

export function createWorkspaceDispatchStorageAdapter(): WorkspaceDispatchStorageAdapter {
  if (cachedAdapter) {
    return cachedAdapter
  }

  const redis = getRedisClient()

  if (redis) {
    logger.info('Workspace dispatcher: Using Redis storage')
    const adapter = new RedisWorkspaceDispatchStorage(redis)
    cachedAdapter = adapter
    return adapter
  }

  logger.warn(
    'Workspace dispatcher: Using in-memory storage; distributed fairness is disabled in multi-process deployments'
  )
  const adapter = new MemoryWorkspaceDispatchStorage()
  cachedAdapter = adapter
  return adapter
}

export function setWorkspaceDispatchStorageAdapter(adapter: WorkspaceDispatchStorageAdapter): void {
  cachedAdapter = adapter
}

export function resetWorkspaceDispatchStorageAdapter(): void {
  if (cachedAdapter) {
    cachedAdapter.dispose()
    cachedAdapter = null
  }
}
