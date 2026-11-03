import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { withUtcTimestamps } from '@sim/db/timestamps'
import { generateId } from '@sim/utils/id'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({ current: undefined as PostgresJsDatabase | undefined }))
vi.mock('@sim/db', async () => ({
  ...(await import('@sim/db/schema')),
  get db() {
    if (!database.current) throw new Error('Test database not initialized')
    return database.current
  },
}))

import {
  type PerformUpdateWorkflowMcpServerParams,
  performCreateWorkflowMcpServer,
  performUpdateWorkflowMcpServer,
} from '@/lib/mcp/orchestration/workflow-mcp-lifecycle'

/**
 * A public workflow MCP server runs its workflows for anyone holding the URL, so
 * only a caller allowed to change visibility may set `isPublic`; everyone else
 * keeps editing the server without touching it.
 */
describe('workflow MCP server visibility in PostgreSQL', () => {
  const schema = `workflow_mcp_visibility_${generateId().replaceAll('-', '')}`
  const connection = postgres(
    readTestDatabaseUrl(),
    withUtcTimestamps({ max: 2, connection: { search_path: schema }, onnotice: () => undefined })
  )
  const actor = { projectLegacyAudit: false, publishEffects: false } as const

  beforeAll(async () => {
    await connection`CREATE SCHEMA ${connection(schema)}`
    await connection`CREATE TABLE workflow_mcp_server (
      id text PRIMARY KEY, workspace_id text NOT NULL, created_by text NOT NULL,
      name text NOT NULL, description text, is_public boolean NOT NULL DEFAULT false,
      deleted_at timestamp, created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )`
    database.current = drizzle(connection)
  })

  afterAll(async () => {
    await connection`DROP SCHEMA ${connection(schema)} CASCADE`
    await connection.end()
  })

  beforeEach(async () => {
    await connection`DELETE FROM workflow_mcp_server`
    await connection`INSERT INTO workflow_mcp_server (id, workspace_id, created_by, name, is_public)
      VALUES ('private', 'ws', 'owner', 'Private', false), ('public', 'ws', 'owner', 'Public', true)`
  })

  async function visibility(id: string) {
    const [row] = await connection<{ name: string; is_public: boolean }[]>`
      SELECT name, is_public FROM workflow_mcp_server WHERE id = ${id}`
    return row
  }

  function update(
    serverId: string,
    allowVisibilityChange: boolean,
    fields: Partial<PerformUpdateWorkflowMcpServerParams>
  ) {
    return performUpdateWorkflowMcpServer({
      ...actor,
      serverId,
      workspaceId: 'ws',
      userId: 'member',
      allowVisibilityChange,
      ...fields,
    })
  }

  it('refuses to make a private server public without visibility authority', async () => {
    const result = await update('private', false, { isPublic: true })
    expect(result).toMatchObject({ success: false, errorCode: 'forbidden' })
    expect(await visibility('private')).toEqual({ name: 'Private', is_public: false })
  })

  it('refuses to make a public server private without visibility authority', async () => {
    const result = await update('public', false, { name: 'Renamed', isPublic: false })
    expect(result).toMatchObject({ success: false, errorCode: 'forbidden' })
    expect(await visibility('public')).toEqual({ name: 'Public', is_public: true })
  })

  it('saves other fields when the submitted visibility is unchanged', async () => {
    const result = await update('public', false, { name: 'Renamed', isPublic: true })
    expect(result).toMatchObject({ success: true, server: { name: 'Renamed', isPublic: true } })
    expect(result.updatedFields).not.toContain('isPublic')
    expect(await visibility('public')).toEqual({ name: 'Renamed', is_public: true })
  })

  it('reports a missing server as not found, not forbidden', async () => {
    const result = await update('missing', false, { isPublic: true })
    expect(result).toMatchObject({ success: false, errorCode: 'not_found' })
  })

  it('does not reveal a server in another workspace', async () => {
    const result = await update('private', false, { isPublic: true, workspaceId: 'other-ws' })
    expect(result).toMatchObject({ success: false, errorCode: 'not_found' })
  })

  it('changes visibility with visibility authority', async () => {
    const result = await update('private', true, { isPublic: true })
    expect(result).toMatchObject({ success: true, server: { isPublic: true } })
    expect(await visibility('private')).toEqual({ name: 'Private', is_public: true })
  })

  it('refuses to create a public server without visibility authority', async () => {
    const result = await performCreateWorkflowMcpServer({
      ...actor,
      workspaceId: 'ws',
      userId: 'member',
      name: 'Exposed',
      isPublic: true,
      allowVisibilityChange: false,
    })
    expect(result).toMatchObject({ success: false, errorCode: 'forbidden' })
    const [{ count }] = await connection<{ count: number }[]>`
      SELECT count(*)::int AS count FROM workflow_mcp_server`
    expect(count).toBe(2)
  })
})
