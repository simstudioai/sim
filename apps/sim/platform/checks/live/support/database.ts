import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { generateId } from '@sim/utils/id'
import postgres from 'postgres'

/**
 * The live suite's own reach into the database the app serves (`PLATFORM_LIVE_DATABASE_URL`):
 * seeding the sessions and per-check rows a check needs, and putting back what a check changed.
 * Refuses any database that is not a loopback test database.
 */
function requireDatabaseUrl(): string {
  const value = process.env.PLATFORM_LIVE_DATABASE_URL
  if (!value) {
    throw new Error('PLATFORM_LIVE_DATABASE_URL is required: the live checks seed their own rows')
  }
  return assertDisposableTestDatabaseUrl(value).toString()
}

/** Runs `work` on its own connection and closes it, whatever happened. */
export async function withLiveDatabase<T>(work: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(requireDatabaseUrl(), { max: 1 })
  try {
    return await work(sql)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

/** A person made for one check, whom {@link removePerson} deletes with everything they own. */
export interface SeededPerson {
  id: string
  email: string
}

/**
 * Seeds an account no other check reads, optionally a member of `organizationId` with `role`.
 * The id carries `prefix` so a leftover from a killed run is recognizable.
 */
export async function seedPerson(
  prefix: string,
  membership?: { organizationId: string; role: 'owner' | 'admin' | 'member' }
): Promise<SeededPerson> {
  const id = `platform-live-${prefix}-${generateId()}`
  const email = `${id}@platform-live.test`
  await withLiveDatabase((sql) =>
    sql.begin(async (tx) => {
      await tx`insert into "user" (id, name, email, normalized_email, email_verified, created_at, updated_at)
        values (${id}, ${`Live ${prefix}`}, ${email}, ${email}, true, now(), now())`
      await tx`insert into user_stats (id, user_id) values (${`${id}-stats`}, ${id})`
      if (membership) {
        await tx`insert into member (id, user_id, organization_id, role)
          values (${`${id}-member`}, ${id}, ${membership.organizationId}, ${membership.role})`
      }
    })
  )
  return { id, email }
}

/**
 * Deletes a seeded person, the personal organization the app may have made them, and the
 * workspaces they own with every grant on them, so nothing they left behind changes what a later
 * check reads.
 */
async function removePerson(person: SeededPerson) {
  await withLiveDatabase(async (sql) => {
    const owned = await sql<{ id: string }[]>`
      select id from workspace where owner_id = ${person.id}`
    if (owned.length > 0) {
      const workspaceIds = owned.map(({ id }) => id)
      await sql`delete from permissions
        where entity_type = 'workspace' and entity_id in ${sql(workspaceIds)}`
      await sql`delete from workspace where id in ${sql(workspaceIds)}`
    }
    // A project restricts deleting its organization and its owner, so it goes before both.
    await sql`delete from project where owner_id = ${person.id}`
    await sql`delete from organization where kind = 'personal' and id in (
      select organization_id from member where user_id = ${person.id})`
    await sql`delete from "user" where id = ${person.id}`
  })
}

/** Runs `check` with a person seeded for it alone, and removes them afterwards whatever happened. */
export async function withPerson<T>(
  prefix: string,
  membership: Parameters<typeof seedPerson>[1],
  check: (person: SeededPerson) => Promise<T>
): Promise<T> {
  const person = await seedPerson(prefix, membership)
  try {
    return await check(person)
  } finally {
    await removePerson(person)
  }
}
