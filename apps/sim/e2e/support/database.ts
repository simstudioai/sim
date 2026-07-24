import { sleep } from '@sim/utils/helpers'
import postgres from 'postgres'
import { isLoopbackAddress } from './hosts'

const DATABASE_NAME_PATTERN = /^sim_e2e_[a-z0-9_]+$/
const PROTECTED_DATABASES = new Set(['postgres', 'simstudio', 'template0', 'template1'])

export interface RunDatabase {
  name: string
  url: string
}

export function createRunDatabaseName(runId: string): string {
  const suffix = runId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const name = `sim_e2e_${suffix}`
  assertSafeDatabaseName(name)
  return name
}

export function assertSafeDatabaseName(name: string): void {
  if (!DATABASE_NAME_PATTERN.test(name) || PROTECTED_DATABASES.has(name)) {
    throw new Error(`Refusing unsafe E2E database name: ${name}`)
  }
}

export function assertLoopbackPostgresUrl(rawUrl: string): URL {
  const url = new URL(rawUrl)
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error(`E2E PostgreSQL admin URL requires postgres protocol, received ${url.protocol}`)
  }
  if (url.search || url.hash) {
    throw new Error('E2E PostgreSQL admin URL must not contain query parameters or a fragment')
  }
  if (!isLoopbackAddress(hostname)) {
    throw new Error(`E2E PostgreSQL admin URL must be loopback, received ${url.hostname}`)
  }
  return url
}

export function buildRunDatabaseUrl(adminUrl: string, databaseName: string): string {
  assertSafeDatabaseName(databaseName)
  const url = assertLoopbackPostgresUrl(adminUrl)
  url.pathname = `/${databaseName}`
  return url.toString()
}

export async function createRunDatabase(
  adminUrl: string,
  databaseName: string
): Promise<RunDatabase> {
  assertSafeDatabaseName(databaseName)
  assertLoopbackPostgresUrl(adminUrl)
  const sql = postgres(adminUrl, { max: 1, connect_timeout: 10 })
  try {
    await sql.unsafe(`CREATE DATABASE "${databaseName}"`)
  } finally {
    await sql.end()
  }
  return { name: databaseName, url: buildRunDatabaseUrl(adminUrl, databaseName) }
}

export async function dropRunDatabase(adminUrl: string, databaseName: string): Promise<void> {
  assertSafeDatabaseName(databaseName)
  assertLoopbackPostgresUrl(adminUrl)
  const sql = postgres(adminUrl, {
    max: 1,
    connect_timeout: 10,
    onnotice: () => {},
  })
  try {
    await sql.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  } finally {
    await sql.end()
  }
}

export async function dropRunDatabaseWithRetries(
  adminUrl: string,
  databaseName: string,
  deadlineMs = 5_000,
  intervalMs = 100
): Promise<void> {
  const deadline = Date.now() + deadlineMs
  let lastError: unknown
  do {
    try {
      await dropRunDatabase(adminUrl, databaseName)
      lastError = undefined
    } catch (error) {
      lastError = error
    }
    await sleep(intervalMs)
  } while (Date.now() < deadline)
  if (await runDatabaseExists(adminUrl, databaseName)) {
    throw (
      lastError ??
      new Error(`Guarded E2E database still exists after forced-drop retry window: ${databaseName}`)
    )
  }
}

async function runDatabaseExists(adminUrl: string, databaseName: string): Promise<boolean> {
  assertSafeDatabaseName(databaseName)
  assertLoopbackPostgresUrl(adminUrl)
  const sql = postgres(adminUrl, { max: 1, connect_timeout: 10, onnotice: () => {} })
  try {
    const rows = await sql<Array<{ exists: boolean }>>`
      SELECT EXISTS(
        SELECT 1 FROM pg_database WHERE datname = ${databaseName}
      ) AS "exists"
    `
    return rows[0]?.exists ?? false
  } finally {
    await sql.end()
  }
}
