import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareDevSchema } from '@sim/db/scripts/prepare-dev-schema'
import { generateId } from '@sim/utils/id'
import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const databaseUrl = process.env.DEV_SCHEMA_TEST_DATABASE_URL

describe.skipIf(!databaseUrl)('dev schema preparation', () => {
  const databaseName = `dev_schema_${generateId().replaceAll('-', '')}`
  let admin: Sql
  let sql: Sql
  let fixtureUrl: string
  let directory: string

  beforeAll(async () => {
    admin = postgres(databaseUrl!, { max: 1, onnotice: () => {} })
    await admin`CREATE DATABASE ${admin(databaseName)}`
    const url = new URL(databaseUrl!)
    url.pathname = `/${databaseName}`
    fixtureUrl = url.toString()
    sql = postgres(fixtureUrl, { max: 1, onnotice: () => {} })
    directory = await mkdtemp(join(tmpdir(), 'dev-schema-'))
    await writeFile(
      join(directory, 'schema.ts'),
      `import { pgTable, text, boolean } from ${JSON.stringify(import.meta.resolve('drizzle-orm/pg-core'))}
export const organization = pgTable('organization', {
  id: text('id').primaryKey(),
  requireSso: boolean('require_sso').notNull().default(false),
})`
    )
    await writeFile(
      join(directory, 'drizzle.config.ts'),
      `export default {
  dialect: 'postgresql',
  schema: ${JSON.stringify(join(directory, 'schema.ts'))},
  dbCredentials: { url: process.env.DATABASE_URL },
}`
    )
  })

  beforeEach(async () => {
    await sql`DROP TABLE IF EXISTS organization`
  })

  afterAll(async () => {
    await sql?.end()
    if (admin) {
      await admin`DROP DATABASE IF EXISTS ${admin(databaseName)}`
      await admin.end()
    }
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  async function createLegacyOrganization() {
    await sql`CREATE TABLE organization (id text PRIMARY KEY, departed_member_usage numeric NOT NULL DEFAULT 0)`
    await sql`INSERT INTO organization (id, departed_member_usage) VALUES ('existing-org', 12.5)`
  }

  /** Run the actual CLI without a TTY, matching the deployment failure. */
  function push() {
    return spawnSync(
      'bunx',
      [
        '--no-install',
        'drizzle-kit',
        'push',
        '--config',
        join(directory, 'drizzle.config.ts'),
        '--force',
      ],
      {
        env: { ...process.env, DATABASE_URL: fixtureUrl },
        encoding: 'utf8',
        timeout: 30_000,
      }
    )
  }

  it('resolves the real noninteractive rename failure without renaming existing data', async () => {
    await createLegacyOrganization()
    const before = push()
    expect(before.error).toBeUndefined()
    expect(before.stdout + before.stderr).toContain('Interactive prompts require a TTY terminal')

    expect(await prepareDevSchema(sql)).toBe(true)
    expect(await sql`SELECT * FROM organization`).toEqual([
      { id: 'existing-org', departed_member_usage: '12.5', require_sso: false },
    ])

    const after = push()
    expect(after.error).toBeUndefined()
    expect(after.status).toBe(0)
    expect(after.stdout + after.stderr).not.toContain('Interactive prompts require a TTY terminal')
    expect(await sql`SELECT * FROM organization`).toEqual([
      { id: 'existing-org', require_sso: false },
    ])
  }, 60_000)

  it('preserves an enabled SSO policy when rerun', async () => {
    await createLegacyOrganization()
    await prepareDevSchema(sql)
    await sql`UPDATE organization SET require_sso = true`
    expect(await prepareDevSchema(sql)).toBe(false)
    expect(await sql`SELECT require_sso, departed_member_usage FROM organization`).toEqual([
      { require_sso: true, departed_member_usage: '12.5' },
    ])
  })

  it('runs the CI entry point with an empty optional direct URL', async () => {
    await createLegacyOrganization()
    const result = spawnSync(
      'bun',
      ['run', fileURLToPath(new URL('./prepare-dev-schema.ts', import.meta.url))],
      {
        env: {
          ...process.env,
          SIM_DEV_DB_PUSH: '1',
          DATABASE_URL: fixtureUrl,
          MIGRATION_DATABASE_URL: '',
        },
        encoding: 'utf8',
        timeout: 30_000,
      }
    )
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(await sql`SELECT require_sso FROM organization`).toEqual([{ require_sso: false }])
  }, 30_000)

  it('leaves fresh databases for push to initialize', async () => {
    expect(await prepareDevSchema(sql)).toBe(false)
    const result = push()
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    await sql`INSERT INTO organization (id) VALUES ('new-org')`
    expect(await sql`SELECT require_sso FROM organization`).toEqual([{ require_sso: false }])
  }, 30_000)

  it('serializes overlapping preparation attempts', async () => {
    await createLegacyOrganization()
    const other = postgres(fixtureUrl, { max: 1, onnotice: () => {} })
    try {
      const results = await Promise.all([prepareDevSchema(sql), prepareDevSchema(other)])
      expect(results.sort()).toEqual([false, true])
      expect(await sql`SELECT require_sso FROM organization`).toEqual([{ require_sso: false }])
    } finally {
      await other.end()
    }
  })
})
