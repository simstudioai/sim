import { db } from '@sim/db'
import { folder } from '@sim/db/schema'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareUploadFolders } from '@/lib/workspace-files/upload-folders'

const connection = vi.hoisted(() => ({ close: async () => {} }))

vi.mock('@sim/db', async () => {
  const { readTestDatabaseUrl } = await import('@sim/db/testing/test-infrastructure')
  const { default: postgres } = await import('postgres')
  const { drizzle } = await import('drizzle-orm/postgres-js')
  const client = postgres(readTestDatabaseUrl(), { max: 1 })
  const database = drizzle(client)
  connection.close = () => client.end()
  return { db: database, dbFor: () => database }
})

describe('folder upload preparation in Postgres', () => {
  beforeAll(async () => {
    await db.execute(sql`CREATE TEMP TABLE folder (
      id text PRIMARY KEY, workspace_id text NOT NULL, user_id text NOT NULL,
      resource_type text NOT NULL, name text NOT NULL, parent_id text,
      sort_order integer NOT NULL DEFAULT 0, locked boolean NOT NULL DEFAULT false, deleted_at timestamp,
      created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
    )`)
    await db.execute(sql`CREATE UNIQUE INDEX upload_folder_names
      ON folder (workspace_id, resource_type, coalesce(parent_id, ''), name)
      WHERE deleted_at IS NULL`)
  })
  beforeEach(async () => {
    await db.delete(folder)
  })
  afterAll(async () => {
    await connection.close()
  })

  const prepare = (paths: string[][], targetFolderId: string | null = null) =>
    prepareUploadFolders({ workspaceId: 'workspace', userId: 'user', targetFolderId, paths })

  it('keeps both imports and binds nested children to their own new root', async () => {
    const first = await prepare([['Documents'], ['Documents', 'Contracts'], ['Documents', 'Empty']])
    const second = await prepare([['Documents', 'Contracts'], ['Documents']])
    const firstRoot = first.find((entry) => entry.path.length === 1)
    const secondRoot = second.find((entry) => entry.path.length === 1)
    expect(firstRoot?.name).toBe('Documents')
    expect(secondRoot?.name).toBe('Documents (1)')
    expect(secondRoot?.id).not.toBe(firstRoot?.id)
    const stored = await db.select().from(folder)
    expect(stored).toHaveLength(5)
    expect(
      stored.filter((entry) => entry.name === 'Contracts').map((entry) => entry.parentId)
    ).toEqual(expect.arrayContaining([firstRoot?.id, secondRoot?.id]))
    expect(stored.find((entry) => entry.name === 'Empty')?.parentId).toBe(firstRoot?.id)
  })

  it.each(['A'.repeat(255), `${'A'.repeat(250)}😀XYZ`])(
    'keeps repeated maximum-length roots addressable without splitting Unicode: %s',
    async (name) => {
      const imports: Awaited<ReturnType<typeof prepare>>[] = []
      for (let attempt = 0; attempt < 3; attempt += 1) {
        imports.push(await prepare([[name], [name, 'Child']]))
      }
      const stored = await db.select().from(folder)
      const roots = stored.filter((row) => row.parentId === null)
      expect(roots).toHaveLength(3)
      expect(new Set(roots.map((row) => row.name)).size).toBe(3)
      expect(roots.some((row) => row.name === name)).toBe(true)
      for (const row of roots) {
        expect(row.name.length).toBeLessThanOrEqual(255)
        expect(() => encodeURIComponent(row.name)).not.toThrow()
        expect(stored.filter((child) => child.parentId === row.id)).toHaveLength(1)
      }
      expect(imports[1][0].name.endsWith(' (1)')).toBe(true)
      expect(imports[2][0].name.endsWith(' (2)')).toBe(true)
    }
  )

  it.each(['elsewhere', 'archived', 'workflow'])(
    'refuses the %s destination without creating anything',
    async (kind) => {
      await db.insert(folder).values({
        id: 'target',
        userId: 'user',
        workspaceId: kind === 'elsewhere' ? 'other' : 'workspace',
        resourceType: kind === 'workflow' ? 'workflow' : 'file',
        name: 'Target',
        deletedAt: kind === 'archived' ? new Date() : null,
      })
      await expect(prepare([['Upload']], 'target')).rejects.toMatchObject({ code: 'not_found' })
      expect(await db.select().from(folder)).toHaveLength(1)
    }
  )

  it.each(['..', 'A'.repeat(256)])(
    'rejects an invalid descendant before any folder can commit: %s',
    async (name) => {
      await expect(prepare([['Safe'], ['Safe', name]])).rejects.toMatchObject({
        code: 'validation',
      })
      expect(await db.select().from(folder)).toHaveLength(0)
    }
  )

  it('requires declared ancestors instead of silently flattening files', async () => {
    await expect(prepare([['Missing', 'Child']])).rejects.toMatchObject({ code: 'validation' })
    expect(await db.select().from(folder)).toHaveLength(0)
  })

  it('counts the destination depth when bounding new paths', async () => {
    const chain = Array.from({ length: 64 }, (_, index) => ({
      id: `depth-${index}`,
      userId: 'user',
      workspaceId: 'workspace',
      resourceType: 'file' as const,
      name: 'A',
      parentId: index === 0 ? null : `depth-${index - 1}`,
    }))
    await db.insert(folder).values(chain)
    await expect(prepare([['Child']], 'depth-63')).rejects.toMatchObject({ code: 'validation' })
    expect(await db.select().from(folder).where(eq(folder.name, 'Child'))).toHaveLength(0)
  })

  it('rejects an entire upload that would exceed the workspace folder capacity', async () => {
    await db.execute(sql`
      INSERT INTO folder (id, workspace_id, user_id, resource_type, name)
      SELECT 'existing-' || position, 'workspace', 'user', 'file', 'Existing ' || position
      FROM generate_series(1, 9999) AS series(position)
    `)
    await expect(prepare([['Incoming'], ['Incoming', 'Child']])).rejects.toMatchObject({
      code: 'conflict',
    })
    expect(await db.select().from(folder).where(eq(folder.name, 'Incoming'))).toHaveLength(0)
  })
})
