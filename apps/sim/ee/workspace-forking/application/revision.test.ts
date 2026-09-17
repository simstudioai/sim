/** @vitest-environment node */
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it, vi } from 'vitest'
import type { DbOrTx } from '@/lib/db/types'
import { WorkspaceOperationConflict } from '@/lib/workspaces/operations/receipts'
import {
  assertForkPreviewFresh,
  loadForkPreviewRevision,
} from '@/ee/workspace-forking/application/revision'

vi.unmock('drizzle-orm')
vi.unmock('@sim/db/schema')

const scope = {
  sourceWorkspaceId: 'source',
  targetWorkspaceId: 'target',
  edge: { parentWorkspaceId: 'target', childWorkspaceId: 'source' },
}

function mockRevisionExecutor(overrides: { count?: string; bytes?: string; digest?: string } = {}) {
  const execute = vi.fn(async (_query: SQL) => [
    { category: 'files', count: '3', bytes: '1024', digest: 'file-revision', ...overrides },
  ])
  return { execute, executor: { execute } as unknown as DbOrTx }
}

describe('fork preview revisions', () => {
  it('reads every category in one bounded query and excludes files the sync cannot copy', async () => {
    const { execute, executor } = mockRevisionExecutor()
    await loadForkPreviewRevision(executor, scope, {})

    expect(execute).toHaveBeenCalledTimes(1)
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0])
    expect(query.sql).toMatch(/"workspace_files"\."context" = \$\d+/)
    expect(query.sql).toContain('"workspace_files"."deleted_at" is null')
    expect(query.params).toContain('workspace')
    expect(query.sql).toContain("ARRAY['updated_at', 'storage_used_bytes']")
    expect(query.sql.match(/LIMIT \$\d+/g)).toHaveLength(20)
    expect(query.params.filter((value) => value === 100_001)).toHaveLength(20)
    expect(query.params).toContain('source')
    expect(query.params).toContain('target')
    expect(query.params).toContain('mappings')
    expect(query.params).toContain('block_identities')
    expect(query.params).toContain('dependent_values')
    expect(query.params.some(Array.isArray)).toBe(false)
  })

  it('supports creating a fork without a target or existing edge', async () => {
    const { execute, executor } = mockRevisionExecutor()
    await loadForkPreviewRevision(executor, { sourceWorkspaceId: 'source' }, {})

    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0])
    expect(query.sql.match(/LIMIT \$\d+/g)).toHaveLength(17)
    expect(query.params).not.toContain('target')
    expect(query.params).not.toContain('mappings')
    expect(query.params.some((value) => value == null)).toBe(false)
  })

  it.each([
    { count: '100001', bytes: '1', message: 'Fork preview files exceeds its 100000 row ceiling' },
    {
      count: '1',
      bytes: String(64 * 1024 * 1024 + 1),
      message: 'Fork preview files exceeds its 64 MiB byte ceiling',
    },
  ])('rejects an oversized category with the actual limiting budget: $message', async (row) => {
    const { executor } = mockRevisionExecutor(row)
    await expect(loadForkPreviewRevision(executor, scope, {})).rejects.toMatchObject({
      statusCode: 413,
      message: row.message,
    })
  })

  it('accepts categories exactly at both limits', async () => {
    const { executor } = mockRevisionExecutor({ count: '100000', bytes: String(64 * 1024 * 1024) })
    await expect(loadForkPreviewRevision(executor, scope, {})).resolves.toMatchObject({
      categories: { files: 'file-revision' },
    })
  })

  it('keeps scope and copy choices bound to the fingerprint', async () => {
    const { executor } = mockRevisionExecutor()
    const original = await loadForkPreviewRevision(executor, scope, {})
    const changedScope = await loadForkPreviewRevision(
      executor,
      { ...scope, targetWorkspaceId: 'other-target' },
      {}
    )
    const changedChoices = await loadForkPreviewRevision(executor, scope, { copyResources: [] })
    expect(changedScope.fingerprint).not.toBe(original.fingerprint)
    expect(changedChoices.fingerprint).not.toBe(original.fingerprint)
  })

  it('still refuses apply when a reviewed resource changes', async () => {
    const { executor, execute } = mockRevisionExecutor()
    const preview = await loadForkPreviewRevision(executor, scope, {})
    const admission = {
      workspaceId: 'source',
      requestId: 'request',
      requestHash: 'request-hash',
      previewFingerprint: preview.fingerprint,
      choices: {},
    }
    await expect(assertForkPreviewFresh(executor, scope, admission)).resolves.toBeUndefined()
    execute.mockResolvedValue([{ category: 'files', count: '3', bytes: '1024', digest: 'changed' }])
    await expect(assertForkPreviewFresh(executor, scope, admission)).rejects.toBeInstanceOf(
      WorkspaceOperationConflict
    )
  })
})
