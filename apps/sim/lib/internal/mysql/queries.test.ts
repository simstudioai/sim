import { describe, expect, it, vi } from 'vitest'

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
  sanitizeMysqlIdentifier,
  validateMysqlQuery,
} from '@/lib/internal/mysql/queries'

describe('MySQL queries', () => {
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
})
