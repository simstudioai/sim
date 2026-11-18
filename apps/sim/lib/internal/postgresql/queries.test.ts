import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecutePostgresQuery } = vi.hoisted(() => ({
  mockExecutePostgresQuery: vi.fn(),
}))

vi.mock('@/lib/internal/postgresql/client', () => ({
  executePostgresQuery: mockExecutePostgresQuery,
}))

import type { PostgresClient } from '@/lib/internal/postgresql/client'
import {
  deletePostgresRows,
  insertPostgresRows,
  sanitizePostgresIdentifier,
  updatePostgresRows,
  validatePostgresQuery,
} from '@/lib/internal/postgresql/queries'

const pendingQuery = { cancel: vi.fn() }
const mockClient = {
  unsafe: vi.fn(() => pendingQuery),
} as unknown as PostgresClient

describe('PostgreSQL queries', () => {
  beforeEach(() => {
    mockExecutePostgresQuery.mockResolvedValue([{ id: 1 }])
  })

  it('builds a parameterized INSERT and preserves its result', async () => {
    const controller = new AbortController()

    await expect(
      insertPostgresRows(
        mockClient,
        'public.users',
        { email: 'person@example.com', active: true },
        controller.signal
      )
    ).resolves.toEqual({ rows: [{ id: 1 }], rowCount: 1 })

    expect(mockClient.unsafe).toHaveBeenCalledWith(
      'INSERT INTO "public"."users" ("email", "active") VALUES ($1, $2) RETURNING *',
      ['person@example.com', true]
    )
    expect(mockExecutePostgresQuery).toHaveBeenCalledWith(pendingQuery, controller.signal)
  })

  it('builds parameterized UPDATE values while preserving the existing WHERE syntax', async () => {
    await updatePostgresRows(mockClient, 'users', { active: false }, 'id = 42')

    expect(mockClient.unsafe).toHaveBeenCalledWith(
      'UPDATE "users" SET "active" = $1 WHERE id = 42 RETURNING *',
      [false]
    )
  })

  it('rejects dangerous WHERE clauses before issuing an UPDATE or DELETE', async () => {
    await expect(
      updatePostgresRows(mockClient, 'users', { active: false }, 'id = 42; DROP TABLE users')
    ).rejects.toThrow('WHERE clause contains potentially dangerous operation')
    await expect(deletePostgresRows(mockClient, 'users', "id = 42 OR 'x'='x'")).rejects.toThrow(
      'WHERE clause contains potentially dangerous operation'
    )
    expect(mockClient.unsafe).not.toHaveBeenCalled()
  })

  it('preserves identifier validation and query allowlisting', () => {
    expect(sanitizePostgresIdentifier('public.users')).toBe('"public"."users"')
    expect(() => sanitizePostgresIdentifier('users; DROP TABLE users')).toThrow(
      'Invalid identifier'
    )
    expect(validatePostgresQuery('ANALYZE users')).toEqual({ isValid: true })
    expect(validatePostgresQuery('DROP TABLE users')).toEqual({
      isValid: false,
      error:
        'Only SELECT, INSERT, UPDATE, DELETE, WITH, EXPLAIN, ANALYZE, and SHOW statements are allowed',
    })
  })
})
