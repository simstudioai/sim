import { describe, expect, it, vi } from 'vitest'

const clientMocks = vi.hoisted(() => ({
  createPostgresClient: vi.fn(),
}))

const queryMocks = vi.hoisted(() => ({
  deletePostgresRows: vi.fn(),
  insertPostgresRows: vi.fn(),
  introspectPostgresSchema: vi.fn(),
  queryPostgres: vi.fn(),
  updatePostgresRows: vi.fn(),
  validatePostgresQuery: vi.fn(),
}))

vi.mock('@/lib/internal/postgresql/client', () => clientMocks)
vi.mock('@/lib/internal/postgresql/queries', () => queryMocks)

import {
  executePostgresqlStatement,
  PostgresqlOperationInputError,
} from '@/lib/internal/postgresql/operations'

const CONNECTION = {
  host: 'db.example.com',
  port: 5432,
  database: 'application',
  username: 'application',
  password: 'secret',
  ssl: 'required',
} as const

describe('PostgreSQL operations', () => {
  it('rejects disallowed execute statements before creating a connection', () => {
    queryMocks.validatePostgresQuery.mockReturnValue({
      isValid: false,
      error:
        'Only SELECT, INSERT, UPDATE, DELETE, WITH, EXPLAIN, ANALYZE, and SHOW statements are allowed',
    })

    expect(() => executePostgresqlStatement({ ...CONNECTION, query: 'DROP TABLE users' })).toThrow(
      new PostgresqlOperationInputError(
        'Query validation failed: Only SELECT, INSERT, UPDATE, DELETE, WITH, EXPLAIN, ANALYZE, and SHOW statements are allowed'
      )
    )
    expect(clientMocks.createPostgresClient).not.toHaveBeenCalled()
  })
})
