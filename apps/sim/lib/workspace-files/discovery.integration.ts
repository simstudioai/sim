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
  getWorkspaceFile,
  listWorkspaceFiles,
  queryWorkspaceFiles,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'

/** Real list/read queries: unlisted rows interleave with listed rows across page boundaries. */
describe('workspace file discovery in PostgreSQL', () => {
  const schema = `file_discovery_${generateId().replaceAll('-', '')}`
  const connection = postgres(
    readTestDatabaseUrl(),
    withUtcTimestamps({
      max: 2,
      connection: { search_path: schema },
      onnotice: () => undefined,
    })
  )

  beforeAll(async () => {
    await connection`CREATE SCHEMA ${connection(schema)}`
    await connection`CREATE TABLE workspace_files (
      id text PRIMARY KEY, key text NOT NULL DEFAULT 'key', user_id text NOT NULL DEFAULT 'owner',
      workspace_id text NOT NULL DEFAULT 'ws', organization_id text, folder_id text,
      context text NOT NULL DEFAULT 'workspace', discovery text NOT NULL DEFAULT 'listed',
      chat_id uuid, message_id text, original_name text NOT NULL, display_name text,
      content_type text NOT NULL DEFAULT 'text/plain', size_bytes bigint NOT NULL DEFAULT 1,
      width int, height int, deleted_at timestamp, uploaded_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(), content_updated_at timestamp NOT NULL DEFAULT now(),
      secret_provenance_version integer
    )`
    await connection`INSERT INTO workspace_files (id, original_name, discovery, content_type) VALUES
      ('a', 'a.txt', 'listed', 'text/plain'), ('b', 'b.txt', 'unlisted', 'text/plain'),
      ('c', 'c.txt', 'listed', 'text/plain'), ('d', 'd.dashboard', 'unlisted', 'text/x-sim-dashboard'),
      ('e', 'e.txt', 'listed', 'text/plain')`
    await connection`INSERT INTO workspace_files (id, original_name, context, discovery)
      VALUES ('chat', 'attachment.txt', 'mothership', 'unlisted')`
    await connection`INSERT INTO workspace_files (id, original_name, workspace_id)
      VALUES ('foreign', 'foreign.txt', 'other-workspace')`
    database.current = drizzle(connection)
  })

  afterAll(async () => {
    await connection`DROP SCHEMA ${connection(schema)} CASCADE`
    await connection.end()
  })

  it('filters before pagination and returns the same inventory to ordinary Files callers', async () => {
    const options = { sortBy: 'name' as const, sortOrder: 'asc' as const, limit: 2 }
    const first = await queryWorkspaceFiles('ws', options)
    expect(first.files.map((file) => file.id)).toEqual(['a', 'c'])
    expect(first.nextKeys).not.toBeNull()
    const next = await queryWorkspaceFiles('ws', { ...options, after: first.nextKeys! })
    expect(next.files.map((file) => file.id)).toEqual(['e'])
    expect(next.nextKeys).toBeNull()
    expect(
      (await listWorkspaceFiles('ws', { throwOnError: true })).map((file) => file.id).sort()
    ).toEqual(['a', 'c', 'e'])
    expect(
      (await queryWorkspaceFiles('ws', { ...options, search: '.dashboard' })).files
    ).toHaveLength(0)
  })

  it('admits dashboard inventory explicitly without exposing other unlisted files', async () => {
    const result = await queryWorkspaceFiles('ws', {
      discovery: 'unlisted',
      contentType: 'text/x-sim-dashboard',
      sortBy: 'name',
      sortOrder: 'asc',
      limit: 2,
    })
    expect(result.files.map((file) => file.id)).toEqual(['d'])
  })

  it('keeps unlisted explicit reads subject to existing workspace and chat ownership rules', async () => {
    expect((await getWorkspaceFile('ws', 'b', { throwOnError: true }))?.id).toBe('b')
    expect(await getWorkspaceFile('ws', 'chat', { throwOnError: true })).toBeNull()
    expect(
      (await getWorkspaceFile('ws', 'chat', { includeChatUploads: true, throwOnError: true }))?.id
    ).toBe('chat')
    expect(
      await getWorkspaceFile('other-workspace', 'chat', {
        includeChatUploads: true,
        throwOnError: true,
      })
    ).toBeNull()
  })
})
