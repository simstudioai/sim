import Redis from 'ioredis'

export interface RedisClientConfig {
  host: string
  port: number
  username?: string
  password?: string
  db: number
  family: 4 | 6
  tlsServername?: string
}

export function createRedisClient(config: RedisClientConfig): Redis {
  return new Redis({
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
    db: config.db,
    family: config.family,
    tls: config.tlsServername ? { servername: config.tlsServername } : undefined,
    connectTimeout: 10000,
    commandTimeout: 10000,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  })
}

export function executeRedisClientCommand(
  client: Redis,
  command: string,
  args: Array<string | number>
): Promise<unknown> {
  return client.call(command, ...args)
}
