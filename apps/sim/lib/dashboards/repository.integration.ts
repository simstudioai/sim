import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { withUtcTimestamps } from '@sim/db/timestamps'
import { generateId } from '@sim/utils/id'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({ current: undefined as PostgresJsDatabase | undefined }))
vi.mock('@sim/db', () => ({
  get db() {
    if (!database.current) throw new Error('Test database not initialized')
    return database.current
  },
}))

import {
  getWorkspaceDashboard,
  insertWorkspaceDashboard,
  updateDashboardContent,
} from '@/lib/dashboards/repository'

/** Real conflict and revision semantics: one dashboard per workspace, no lost updates. */
describe('dashboard repository in PostgreSQL', () => {
  const schema = `dashboard_repo_${generateId().replaceAll('-', '')}`
  const connection = postgres(
    readTestDatabaseUrl(),
    withUtcTimestamps({ max: 2, connection: { search_path: schema }, onnotice: () => undefined })
  )

  beforeAll(async () => {
    await connection`CREATE SCHEMA ${connection(schema)}`
    await connection`CREATE TABLE dashboard (
      id text PRIMARY KEY, workspace_id text NOT NULL, content text NOT NULL,
      revision integer NOT NULL DEFAULT 1, created_by text, updated_by text,
      created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
    )`
    await connection`CREATE UNIQUE INDEX dashboard_workspace_id_unique ON dashboard (workspace_id)`
    database.current = drizzle(connection)
  })

  afterAll(async () => {
    await connection`DROP SCHEMA ${connection(schema)} CASCADE`
    await connection.end()
  })

  it('creates one dashboard per workspace and refuses a second', async () => {
    expect(await getWorkspaceDashboard('ws-a')).toBeNull()
    const created = await insertWorkspaceDashboard('ws-a', 'first', 'user-1')
    expect(created).toMatchObject({ workspaceId: 'ws-a', content: 'first', revision: 1 })
    expect(await insertWorkspaceDashboard('ws-a', 'second', 'user-2')).toBeNull()
    expect((await getWorkspaceDashboard('ws-a'))?.content).toBe('first')
    expect(await insertWorkspaceDashboard('ws-b', 'other', 'user-1')).not.toBeNull()
  })

  it('updates only at the expected revision and advances it', async () => {
    const current = await insertWorkspaceDashboard('ws-c', 'original', 'user-1')
    if (!current) throw new Error('ws-c dashboard was not created')
    const updated = await updateDashboardContent(current.id, 'edited', 'user-2', current.revision)
    expect(updated).toMatchObject({
      content: 'edited',
      revision: current.revision + 1,
      updatedBy: 'user-2',
    })
    expect(await updateDashboardContent(current.id, 'stale', 'user-3', current.revision)).toBeNull()
    expect((await getWorkspaceDashboard('ws-c'))?.content).toBe('edited')
  })
})
