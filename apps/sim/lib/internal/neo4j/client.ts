import neo4j, { type Driver } from 'neo4j-driver'
import { validateDatabaseHost } from '@/lib/core/security/input-validation.server'
import type { Neo4jConnectionConfig } from '@/tools/neo4j/types'

function isAuraHost(host: string): boolean {
  return host === 'databases.neo4j.io' || host.endsWith('.databases.neo4j.io')
}

export async function createNeo4jDriver(
  config: Neo4jConnectionConfig,
  signal?: AbortSignal
): Promise<Driver> {
  signal?.throwIfAborted()
  const hostValidation = await validateDatabaseHost(config.host, 'host')
  signal?.throwIfAborted()
  if (!hostValidation.isValid) throw new Error(hostValidation.error)

  const aura = isAuraHost(config.host)
  const protocol = aura ? 'neo4j+s' : config.encryption === 'enabled' ? 'bolt+s' : 'bolt'
  const usePinnedIp = !protocol.endsWith('+s')
  const resolvedHost = hostValidation.resolvedIP ?? config.host
  const uriHost = usePinnedIp
    ? resolvedHost.includes(':')
      ? `[${resolvedHost}]`
      : resolvedHost
    : config.host
  const uri = `${protocol}://${uriHost}:${config.port}`
  const driverConfig: Exclude<Parameters<typeof neo4j.driver>[2], undefined> = {
    maxConnectionPoolSize: 1,
    connectionTimeout: 10_000,
  }
  if (!protocol.endsWith('+s')) {
    driverConfig.encrypted = config.encryption === 'enabled' ? 'ENCRYPTION_ON' : 'ENCRYPTION_OFF'
  }

  const driver = neo4j.driver(uri, neo4j.auth.basic(config.username, config.password), driverConfig)
  const abort = () => {
    void driver.close()
  }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    await driver.verifyConnectivity()
    signal?.throwIfAborted()
    return driver
  } catch (error) {
    await driver.close().catch(() => undefined)
    throw error
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}
