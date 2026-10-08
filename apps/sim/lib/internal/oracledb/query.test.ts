/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildOracleDelete,
  buildOracleInsert,
  buildOracleUpdate,
  normalizeOracleSql,
  validateOracleExecuteQuery,
  validateOracleReadOnlyQuery,
  validateOracleWhere,
} from '@/lib/internal/oracledb/query'

describe('Oracle SQL validation and builders', () => {
  it('accepts ordinary SELECTs and read-only CTEs', () => {
    expect(validateOracleReadOnlyQuery("SELECT 'DROP TABLE users' AS value FROM DUAL")).toEqual({
      isValid: true,
    })
    expect(
      validateOracleReadOnlyQuery(
        'WITH values_ AS (SELECT 1 AS id FROM DUAL) SELECT * FROM values_'
      )
    ).toEqual({ isValid: true })
  })

  it.each([
    'DELETE FROM users',
    'SELECT * FROM users FOR UPDATE',
    'SELECT sequence_name.NEXTVAL FROM DUAL',
    'SELECT * FROM users@remote_db',
    'SELECT /*+ FULL(users) */ * FROM users',
    'SELECT 1 FROM DUAL; DROP TABLE users',
    'WITH FUNCTION f RETURN NUMBER IS BEGIN RETURN 1; END; SELECT f() FROM DUAL',
    'WITH values_ AS (DELETE FROM users RETURNING id) SELECT * FROM values_',
    'WITH values_ AS (SELECT 1 AS id FROM DUAL) DELETE FROM users',
    'WITH values_ AS (SELECT 1 AS id FROM DUAL) CREATE TABLE copied AS SELECT * FROM values_',
  ])('rejects unsafe Query SQL: %s', (sql) => {
    expect(validateOracleReadOnlyQuery(sql).isValid).toBe(false)
  })

  it('restricts Execute to the agreed single-statement surface', () => {
    expect(
      validateOracleExecuteQuery(
        'MERGE INTO target USING source ON (1 = 0) WHEN NOT MATCHED THEN INSERT (id) VALUES (1)'
      ).isValid
    ).toBe(true)
    expect(validateOracleExecuteQuery('EXPLAIN PLAN FOR SELECT * FROM users').isValid).toBe(true)
    expect(validateOracleExecuteQuery('BEGIN NULL; END;').isValid).toBe(false)
    expect(validateOracleExecuteQuery('CREATE PROCEDURE p AS BEGIN NULL; END;').isValid).toBe(false)
    expect(
      validateOracleExecuteQuery(
        'CREATE OR REPLACE TRIGGER trg BEFORE INSERT ON events BEGIN NULL; END;'
      ).isValid
    ).toBe(false)
    expect(validateOracleExecuteQuery('CREATE TABLE events (type VARCHAR2(20))').isValid).toBe(true)
    expect(
      validateOracleExecuteQuery('WITH values_ AS (SELECT 1 AS id FROM DUAL) SELECT * FROM values_')
        .isValid
    ).toBe(true)
    expect(
      validateOracleExecuteQuery('SELECT /*+ FULL(users) */ * FROM users@reporting').isValid
    ).toBe(true)
    expect(
      validateOracleExecuteQuery(
        'WITH values_ AS (SELECT /*+ MATERIALIZE */ * FROM users@reporting) SELECT * FROM values_'
      ).isValid
    ).toBe(true)
    expect(validateOracleExecuteQuery('SELECT * FROM users FOR UPDATE').isValid).toBe(false)
    expect(
      validateOracleExecuteQuery(
        'WITH values_ AS (SELECT * FROM users) SELECT * FROM values_ FOR UPDATE'
      ).isValid
    ).toBe(false)
    expect(
      validateOracleExecuteQuery(
        'WITH FUNCTION f RETURN NUMBER IS BEGIN RETURN 1; END; SELECT f() FROM DUAL'
      ).isValid
    ).toBe(false)
    expect(
      validateOracleExecuteQuery(
        'CREATE OR REPLACE AND RESOLVE NOFORCE JAVA SOURCE NAMED "X" AS public class X {}'
      ).isValid
    ).toBe(false)
    expect(
      validateOracleExecuteQuery('INSERT INTO t(id) VALUES (1) RETURNING id INTO :id').isValid
    ).toBe(false)
  })

  it('removes one copy-pasted trailing semicolon without changing literals', () => {
    expect(normalizeOracleSql("SELECT ';' AS value FROM DUAL;")).toBe(
      "SELECT ';' AS value FROM DUAL"
    )
  })

  it('quotes identifiers and binds structured DML values', () => {
    expect(buildOracleInsert('App', 'Users', { 'Display Name': 'Ada', score: 7 })).toEqual({
      sql: 'INSERT INTO "App"."Users" ("Display Name", "score") VALUES (:b1, :b2)',
      binds: { b1: 'Ada', b2: 7 },
    })
    expect(buildOracleUpdate(undefined, 'Users', { profile: { active: true } }, 'id = 42')).toEqual(
      {
        sql: 'UPDATE "Users" SET "profile" = :b1 WHERE id = 42',
        binds: { b1: '{"active":true}' },
      }
    )
    expect(buildOracleDelete(undefined, 'Users', 'id = 42')).toEqual({
      sql: 'DELETE FROM "Users" WHERE id = 42',
      binds: {},
    })
  })

  it('rejects broad or stacked structured WHERE clauses', () => {
    expect(() => buildOracleDelete(undefined, 'Users', 'id = id')).toThrow('always-true')
    expect(() =>
      buildOracleUpdate(undefined, 'Users', { active: 0 }, 'id = 1; DROP TABLE users')
    ).toThrow()
    expect(() => buildOracleDelete(undefined, 'Users', 'id IN (SELECT id FROM admins)')).toThrow(
      'SELECT'
    )
    expect(() =>
      buildOracleDelete(undefined, 'Users', 'id IN (SELECT id FROM users@remote)')
    ).toThrow()
    expect(() => buildOracleDelete(undefined, 'Users', 'id = 1 /*+ hint */')).toThrow()
    expect(() => buildOracleDelete(undefined, 'Users', "name = 'x\\' OR 1=1")).toThrow(
      'always-true'
    )
    expect(() =>
      buildOracleUpdate(undefined, 'Users', { active: 0 }, "name = 'x\\' OR 2 > 1")
    ).toThrow('always-true')
  })

  it('rejects unbound placeholders in structured WHERE clauses', () => {
    expect(() => buildOracleUpdate(undefined, 'Users', { active: 0 }, 'id = :b1')).toThrow(
      'bind placeholders'
    )
    expect(() => buildOracleDelete(undefined, 'Users', 'id = :id')).toThrow('bind placeholders')
  })

  it.each([
    'id = 7 OR (1 IN (1))',
    'id = 7 OR ((1 NOT IN (2, 3)))',
    "id = 7 OR ('x' IN ('x'))",
    "id = 7 OR (q'[x]' IN (q'[x]'))",
    'id = 7 OR (1 BETWEEN 0 AND 2)',
    'id = 7 OR (NULL IS NULL)',
    'id = 7 OR NOT (1 IN (2))',
    'id = 7 OR NOT NOT (1 IN (1))',
    'id = 7 OR ((1) = (1))',
    'id = 7 OR (1 IN (((1))))',
    "id = 7 OR (N'x' IN (N'x'))",
    "id = 7 OR (NQ'[x]' IN (NQ'[x]'))",
    "id = 7 OR (DATE '2026-01-01' IN (DATE '2026-01-01'))",
    "id = 7 OR (TIMESTAMP '2026-01-01 00:00:00' IN (TIMESTAMP '2026-01-01 00:00:00'))",
  ])('rejects the constant-only predicate %s', (where) => {
    expect(() => buildOracleDelete(undefined, 'Users', where)).toThrow('constant-only')
    expect(() => buildOracleUpdate(undefined, 'Users', { active: 0 }, where)).toThrow(
      'constant-only'
    )
  })

  it.each([
    "status IN ('active', 'pending')",
    'priority + 1 IN (1, 2)',
    'NVL(status, 1) IN (1, 2)',
    'score BETWEEN 1 AND 10',
    'deleted_at IS NULL',
    '1 IN (allowed_value)',
    "id IN (1, 2) OR role IN ('admin', 'owner')",
    'id = 7 OR (1 BETWEEN 0 AND 2 + score)',
  ])('accepts the row-dependent predicate %s', (where) => {
    expect(() => buildOracleDelete(undefined, 'Users', where)).not.toThrow()
    expect(() => buildOracleUpdate(undefined, 'Users', { active: 0 }, where)).not.toThrow()
  })

  it('handles a maximum-size whitespace-heavy predicate without pathological backtracking', () => {
    const where = `id = 7 OR ${' '.repeat(60_000)}allowed_id = 8`
    expect(validateOracleWhere(where)).toEqual({ isValid: true })

    const deeplyNested = `id = 7 OR ${'('.repeat(30_000)}1 IN (1${')'.repeat(30_000)} + score`
    expect(validateOracleWhere(deeplyNested)).toEqual({
      isValid: false,
      error: 'WHERE clause cannot nest parentheses more than 128 levels',
    })
  })

  it('accepts ordinary function, range, quoted-colon, and q-quoted predicates', () => {
    expect(() =>
      buildOracleDelete(
        undefined,
        'Users',
        "UPPER(name) = UPPER(q'[Ada]') AND note = 'a:b' AND id BETWEEN 1 AND 10"
      )
    ).not.toThrow()
    expect(() =>
      buildOracleDelete(
        undefined,
        'Users',
        `JSON_OBJECT('id':(id) RETURNING VARCHAR2) = '{"id":42}'`
      )
    ).not.toThrow()
  })
})
