/**
 * Turns off crash durability on a CI job's throwaway Postgres service. No suite survives a crash of
 * its database, and flushing each commit to the runner's disk is most of a bulk write's cost.
 * Visibility, locking and isolation are unchanged, so every suite checks the same behavior.
 *
 * Service containers take no `-c` flags; each setting reloads without a restart. Exits non-zero
 * unless a fresh session reports all of them applied.
 *
 * Usage: DATABASE_URL=... bun scripts/tune-ci-postgres.ts
 */
import postgres from 'postgres'

const SETTINGS = { fsync: 'off', full_page_writes: 'off', synchronous_commit: 'off' } as const

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')

const admin = postgres(url, { max: 1, onnotice: () => {} })
for (const [name, value] of Object.entries(SETTINGS)) {
  await admin.unsafe(`ALTER SYSTEM SET ${name} = ${value}`)
}
await admin`SELECT pg_reload_conf()`
await admin.end()

let applied: Record<string, string> = {}
for (let attempt = 0; attempt < 10; attempt++) {
  // pg_reload_conf only signals the server, so read from a new session until it has reloaded.
  const probe = postgres(url, { max: 1 })
  const rows = await probe<{ name: string; setting: string }[]>`
    SELECT name, setting FROM pg_settings WHERE name IN ${probe(Object.keys(SETTINGS))}`
  await probe.end()
  applied = Object.fromEntries(rows.map((row) => [row.name, row.setting]))
  if (Object.entries(SETTINGS).every(([name, value]) => applied[name] === value)) {
    console.log('Postgres durability off:', applied)
    process.exit(0)
  }
  await Bun.sleep(500)
}
console.error('::error::Postgres did not apply the CI durability settings:', applied)
process.exit(1)
