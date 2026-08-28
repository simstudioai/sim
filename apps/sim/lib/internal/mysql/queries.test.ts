/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteMysqlCommand } = vi.hoisted(() => ({
  mockExecuteMysqlCommand: vi.fn(),
}))

vi.mock('@/lib/internal/mysql/client', () => ({
  executeMysqlCommand: mockExecuteMysqlCommand,
}))

import {
  buildMysqlDeleteQuery,
  buildMysqlInsertQuery,
  buildMysqlUpdateQuery,
  introspectMysqlDatabase,
  queryMysql,
  sanitizeMysqlIdentifier,
  validateMysqlQuery,
} from '@/lib/internal/mysql/queries'

const connection = { execute: vi.fn(), destroy: vi.fn() }

describe('MySQL queries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves row and affected-row result semantics', async () => {
    mockExecuteMysqlCommand.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce({
      affectedRows: 3,
    })

    await expect(queryMysql(connection as never, 'SELECT 1')).resolves.toEqual({
      rows: [{ id: 1 }],
      rowCount: 1,
    })
    await expect(queryMysql(connection as never, 'UPDATE users SET active = 1')).resolves.toEqual({
      rows: [],
      rowCount: 3,
    })
  })

  it('preserves parameterized INSERT, UPDATE, and DELETE construction', () => {
    expect(
      buildMysqlInsertQuery('application.users', {
        email: 'person@example.com',
        active: true,
      })
    ).toEqual({
      query: 'INSERT INTO `application`.`users` (`email`, `active`) VALUES (?, ?)',
      values: ['person@example.com', true],
    })
    expect(buildMysqlUpdateQuery('users', { active: false }, 'id = 42')).toEqual({
      query: 'UPDATE `users` SET `active` = ? WHERE id = 42',
      values: [false],
    })
    expect(buildMysqlDeleteQuery('users', 'id = 42')).toEqual({
      query: 'DELETE FROM `users` WHERE id = 42',
      values: [],
    })
  })

  it('preserves identifier, WHERE, and statement validation', () => {
    expect(sanitizeMysqlIdentifier('application.users')).toBe('`application`.`users`')
    expect(() => sanitizeMysqlIdentifier('users; DROP TABLE users')).toThrow('Invalid identifier')
    expect(() => buildMysqlDeleteQuery('users', "id = 42 OR 'x'='x'")).toThrow(
      'WHERE clause contains potentially dangerous operation'
    )
    expect(validateMysqlQuery('DESCRIBE users')).toEqual({ isValid: true })
    expect(validateMysqlQuery('DROP TABLE users')).toEqual({
      isValid: false,
      error:
        'Only SELECT, INSERT, UPDATE, DELETE, WITH, SHOW, DESCRIBE, and EXPLAIN statements are allowed',
    })
  })

  it('preserves introspection shaping and passes cancellation to every query', async () => {
    const controller = new AbortController()
    mockExecuteMysqlCommand
      .mockResolvedValueOnce([{ SCHEMA_NAME: 'application' }])
      .mockResolvedValueOnce([{ TABLE_NAME: 'users' }])
      .mockResolvedValueOnce([
        {
          COLUMN_NAME: 'role',
          DATA_TYPE: 'enum',
          COLUMN_TYPE: "enum('admin','member')",
          IS_NULLABLE: 'NO',
          COLUMN_DEFAULT: 'member',
          EXTRA: 'auto_increment',
        },
      ])
      .mockResolvedValueOnce([{ COLUMN_NAME: 'role' }])
      .mockResolvedValueOnce([
        {
          COLUMN_NAME: 'role',
          REFERENCED_TABLE_NAME: 'roles',
          REFERENCED_COLUMN_NAME: 'name',
        },
      ])
      .mockResolvedValueOnce([{ INDEX_NAME: 'users_role_idx', COLUMN_NAME: 'role', NON_UNIQUE: 0 }])

    await expect(
      introspectMysqlDatabase(connection as never, 'application', controller.signal)
    ).resolves.toEqual({
      databases: ['application'],
      tables: [
        {
          name: 'users',
          database: 'application',
          columns: [
            {
              name: 'role',
              type: "enum('admin','member')",
              nullable: false,
              default: 'member',
              isPrimaryKey: true,
              isForeignKey: true,
              autoIncrement: true,
              references: { table: 'roles', column: 'name' },
            },
          ],
          primaryKey: ['role'],
          foreignKeys: [{ column: 'role', referencesTable: 'roles', referencesColumn: 'name' }],
          indexes: [{ name: 'users_role_idx', columns: ['role'], unique: true }],
        },
      ],
    })
    expect(mockExecuteMysqlCommand).toHaveBeenCalledTimes(6)
    for (const call of mockExecuteMysqlCommand.mock.calls) {
      expect(call[3]).toBe(controller.signal)
    }
  })
})
