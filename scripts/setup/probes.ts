import { readFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import tls from 'node:tls'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import postgres from 'postgres'
import { ROOT } from './env-files.ts'

export interface PgProbeResult {
  ok: boolean
  error?: string
  pgvectorAvailable?: boolean
  migrations?: { applied: number | null; journal: number }
}

function journalMigrationCount(): number {
  const journalPath = path.join(ROOT, 'packages/db/migrations/meta/_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] }
  return journal.entries.length
}

export async function pgProbe(dsn: string): Promise<PgProbeResult> {
  const sql = postgres(dsn, { max: 1, connect_timeout: 5, onnotice: () => {} })
  try {
    await sql`select 1`
    const vector = await sql`select 1 from pg_available_extensions where name = 'vector'`
    let applied: number | null = null
    try {
      const rows = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`
      applied = rows[0].n as number
    } catch {
      applied = null
    }
    return {
      ok: true,
      pgvectorAvailable: vector.length > 0,
      migrations: { applied, journal: journalMigrationCount() },
    }
  } catch (error) {
    return { ok: false, error: getErrorMessage(error, 'connection failed') }
  } finally {
    await sql.end({ timeout: 1 })
  }
}

export function redisPing(url: string, timeoutMs = 2000): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      resolve({ ok: false, error: 'invalid REDIS_URL' })
      return
    }
    const port = Number(parsed.port || 6379)
    const secure = parsed.protocol === 'rediss:'
    const socket = secure
      ? tls.connect({
          host: parsed.hostname,
          port,
          servername: process.env.REDIS_TLS_SERVERNAME || parsed.hostname,
        })
      : net.connect({ host: parsed.hostname, port })
    let buffer = ''
    const done = (result: { ok: boolean; error?: string }) => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs, () => done({ ok: false, error: 'timeout' }))
    socket.once('error', (error) => done({ ok: false, error: getErrorMessage(error) }))
    socket.once(secure ? 'secureConnect' : 'connect', () => {
      const auth = parsed.password
        ? `AUTH ${parsed.username || ''} ${parsed.password}\r\n`.replace('AUTH  ', 'AUTH ')
        : ''
      socket.write(`${auth}PING\r\n`)
    })
    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      if (buffer.includes('+PONG')) done({ ok: true })
      else if (
        buffer.includes('-ERR') ||
        buffer.includes('-NOAUTH') ||
        buffer.includes('-WRONGPASS')
      )
        done({ ok: false, error: buffer.split('\r\n')[0] })
    })
  })
}

export async function httpHealth(url: string, timeoutMs = 3000): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return res.ok
  } catch {
    return false
  }
}

/** Polls a probe until it succeeds or the window elapses. */
export async function waitFor(
  probe: () => Promise<boolean>,
  totalMs: number,
  intervalMs = 2000
): Promise<boolean> {
  const deadline = Date.now() + totalMs
  while (Date.now() < deadline) {
    if (await probe()) return true
    await sleep(intervalMs)
  }
  return probe()
}
