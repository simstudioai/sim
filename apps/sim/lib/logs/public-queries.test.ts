/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  flattenMockConditions,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  decodePublicLogCursor,
  encodePublicLogCursor,
  listPublicWorkflowLogs,
} from '@/lib/logs/public-queries'

describe('public log cursor', () => {
  const cursor = {
    startedAt: '2026-08-05T00:01:00.000Z',
    id: 'log-1',
    order: 'desc' as const,
  }

  it('round-trips under the order that minted it', () => {
    expect(decodePublicLogCursor(encodePublicLogCursor(cursor), 'desc')).toEqual(cursor)
  })

  it('rejects reuse under a different order', () => {
    expect(decodePublicLogCursor(encodePublicLogCursor(cursor), 'asc')).toBeNull()
  })

  it('accepts legacy cursors under the order requested by the caller', () => {
    const legacyCursor = Buffer.from(
      JSON.stringify({ startedAt: cursor.startedAt, id: cursor.id })
    ).toString('base64')

    expect(decodePublicLogCursor(legacyCursor, 'desc')).toEqual(cursor)
    expect(decodePublicLogCursor(legacyCursor, 'asc')).toEqual({ ...cursor, order: 'asc' })
  })
})

/**
 * The folder scope is resolved by the adapter, so this query sees only ids. A
 * scope that resolved to nothing has to be expressed as a predicate that matches
 * nothing: `or(undefined, undefined)` is `undefined`, which silently drops the
 * filter and returns the workspace's whole log set.
 */
describe('public workflow log folder scope', () => {
  const lastWhere = () => flattenMockConditions(dbChainMockFns.where.mock.calls.at(-1)?.[0])
  const isUnsatisfiable = (node: Record<string, unknown>) =>
    (node.strings as readonly string[] | undefined)?.[0] === 'false'

  beforeEach(() => {
    resetDbChainMock()
    queueTableRows(schemaMock.workflowExecutionLogs, [])
  })

  async function list(folderScope?: { includesRoot: boolean; folderIds: string[] }) {
    await listPublicWorkflowLogs({
      filters: { workspaceId: 'workspace-1' },
      limit: 50,
      includeExecutionData: false,
      folderScope,
    })
  }

  it('matches no rows when the scope names neither the root nor a folder', async () => {
    await list({ includesRoot: false, folderIds: [] })

    expect(lastWhere().some(isUnsatisfiable)).toBe(true)
  })

  it('constrains to the resolved folders when the scope names some', async () => {
    await list({ includesRoot: false, folderIds: ['folder-1'] })

    expect(lastWhere().some(isUnsatisfiable)).toBe(false)
    expect(lastWhere().some((node) => node.type === 'inArray')).toBe(true)
  })

  it('adds no folder predicate when the caller sent no folder filter', async () => {
    await list()

    expect(lastWhere().some(isUnsatisfiable)).toBe(false)
  })
})
