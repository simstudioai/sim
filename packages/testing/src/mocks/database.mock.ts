import { vi } from 'vitest'

/**
 * Creates mock SQL template literal function.
 * Mimics drizzle-orm's sql tagged template.
 */
export function createMockSql() {
  const sqlFn = (strings: TemplateStringsArray, ...values: any[]) => ({
    strings,
    values,
    toSQL: () => ({ sql: strings.join('?'), params: values }),
  })

  // Add sql.raw method used by some queries
  sqlFn.raw = (rawSql: string) => ({
    rawSql,
    toSQL: () => ({ sql: rawSql, params: [] }),
  })

  // Add sql.join method used to combine multiple SQL fragments
  sqlFn.join = (fragments: any[], separator: any) => ({
    fragments,
    separator,
    toSQL: () => ({
      sql: fragments.map((f) => f?.toSQL?.()?.sql || String(f)).join(separator?.rawSql || ', '),
      params: fragments.flatMap((f) => f?.toSQL?.()?.params || []),
    }),
  })

  return sqlFn
}

/**
 * Creates mock SQL operators (eq, and, or, etc.).
 */
export function createMockSqlOperators() {
  return {
    eq: vi.fn((a, b) => ({ type: 'eq', left: a, right: b })),
    ne: vi.fn((a, b) => ({ type: 'ne', left: a, right: b })),
    gt: vi.fn((a, b) => ({ type: 'gt', left: a, right: b })),
    gte: vi.fn((a, b) => ({ type: 'gte', left: a, right: b })),
    lt: vi.fn((a, b) => ({ type: 'lt', left: a, right: b })),
    lte: vi.fn((a, b) => ({ type: 'lte', left: a, right: b })),
    count: vi.fn((column) => ({ type: 'count', column })),
    avg: vi.fn((column) => ({ type: 'avg', column })),
    sum: vi.fn((column) => ({ type: 'sum', column })),
    min: vi.fn((column) => ({ type: 'min', column })),
    max: vi.fn((column) => ({ type: 'max', column })),
    and: vi.fn((...conditions) => ({ type: 'and', conditions })),
    or: vi.fn((...conditions) => ({ type: 'or', conditions })),
    not: vi.fn((condition) => ({ type: 'not', condition })),
    isNull: vi.fn((column) => ({ type: 'isNull', column })),
    isNotNull: vi.fn((column) => ({ type: 'isNotNull', column })),
    inArray: vi.fn((column, values) => ({ type: 'inArray', column, values })),
    notInArray: vi.fn((column, values) => ({ type: 'notInArray', column, values })),
    exists: vi.fn((subquery) => ({ type: 'exists', subquery })),
    notExists: vi.fn((subquery) => ({ type: 'notExists', subquery })),
    like: vi.fn((column, pattern) => ({ type: 'like', column, pattern })),
    ilike: vi.fn((column, pattern) => ({ type: 'ilike', column, pattern })),
    desc: vi.fn((column) => ({ type: 'desc', column })),
    asc: vi.fn((column) => ({ type: 'asc', column })),
  }
}

/**
 * Pre-wired chain of vi.fn()s for drizzle-style DB queries.
 *
 * Each builder step is a stable, module-level `vi.fn()` — safe to reference
 * inside hoisted `vi.mock()` factories (same pattern as `authMockFns`). Chains
 * are wired at module load time:
 *
 * - `select().from().where()` → returns a builder with `.limit` / `.orderBy` /
 *   `.returning` / `.groupBy` / `.for` terminals
 * - `select().from().innerJoin()|leftJoin()` → returns the same where-builder
 * - `insert().values().returning()` / `update().set().where()` / `delete().where()`
 *
 * Terminals (`limit`, `orderBy`, `returning`, `groupBy`, `for`, `values`)
 * default to resolving `[]` (or `undefined` for `values`). Override per-test
 * with `dbChainMockFns.limit.mockResolvedValueOnce([...])`. `for` mirrors
 * drizzle's `.for('update')` — it returns a Promise with `.limit` / `.orderBy`
 * / `.returning` / `.groupBy` attached, so both `await .where().for('update')`
 * (terminal) and `await .where().for('update').limit(1)` (chained) work.
 * Override the terminal result with `dbChainMockFns.for.mockResolvedValueOnce(
 * [...])`; override the chained result by mocking the downstream terminal
 * (e.g. `dbChainMockFns.limit.mockResolvedValueOnce([...])`).
 *
 * `vi.clearAllMocks()` clears call history but preserves default wiring. Tests
 * that replace a wiring with `mockReturnValue(...)` (not `...Once`) must re-wire
 * in their own `beforeEach`.
 *
 * @example
 * ```ts
 * import { dbChainMock, dbChainMockFns } from '@sim/testing'
 * vi.mock('@sim/db', () => dbChainMock)
 *
 * it('finds rows', async () => {
 *   dbChainMockFns.limit.mockResolvedValueOnce([{ id: 'w-1' }])
 *   // ... exercise code that hits db.select().from().where().limit() ...
 *   expect(dbChainMockFns.where).toHaveBeenCalled()
 * })
 * ```
 */
const offset = vi.fn(() => Promise.resolve([] as unknown[]))
// `.limit()` returns a builder that is awaitable (default empty page) and also
// exposes `.offset()` for keyset/OFFSET paging (`.limit(n).offset(m)`).
const limitBuilder = () => {
  const thenable: any = Promise.resolve([] as unknown[])
  thenable.offset = offset
  return thenable
}
const limit = vi.fn(limitBuilder)
const returning = vi.fn(() => Promise.resolve([] as unknown[]))
const execute = vi.fn(() => Promise.resolve([] as unknown[]))

const terminalBuilder = () => {
  const thenable: any = Promise.resolve([] as unknown[])
  thenable.limit = limit
  thenable.orderBy = orderBy
  thenable.returning = returning
  thenable.groupBy = groupBy
  thenable.for = forClause
  return thenable
}

const orderBy = vi.fn(terminalBuilder)
const having = vi.fn(terminalBuilder)
const groupBy = vi.fn(() => {
  const builder = terminalBuilder()
  builder.having = having
  return builder
})
const forBuilder = terminalBuilder
const forClause = vi.fn(forBuilder)

const onConflictDoUpdate = vi.fn(() => ({ returning }) as unknown as Promise<void>)
const onConflictDoNothing = vi.fn(() => ({ returning }) as unknown as Promise<void>)

const whereBuilder = () => {
  // Some call sites (e.g. `db.select().from(t).where(eq(...))` with no
  // limit/orderBy) await the where directly. Make the builder a thenable so
  // those calls resolve to the default empty array.
  const thenable: any = Promise.resolve([] as unknown[])
  thenable.limit = limit
  thenable.orderBy = orderBy
  thenable.returning = returning
  thenable.groupBy = groupBy
  thenable.for = forClause
  return thenable
}
const where = vi.fn(whereBuilder)

const joinBuilder = (): { where: typeof where; innerJoin: any; leftJoin: any } => ({
  where,
  innerJoin,
  leftJoin,
})
const innerJoin: ReturnType<typeof vi.fn> = vi.fn(joinBuilder)
const leftJoin: ReturnType<typeof vi.fn> = vi.fn(joinBuilder)
const from = vi.fn(joinBuilder)

const select = vi.fn(() => ({ from }))
const selectDistinct = vi.fn(() => ({ from }))
const selectDistinctOn = vi.fn(() => ({ from }))
const values = vi.fn(() => ({ returning, onConflictDoUpdate, onConflictDoNothing }))
const insert = vi.fn(() => ({ values }))
const set = vi.fn(() => ({ where }))
const update = vi.fn(() => ({ set }))
const del = vi.fn(() => ({ where }))
const transaction: ReturnType<typeof vi.fn> = vi.fn(
  async (cb: (tx: any) => unknown): Promise<unknown> => cb(dbChainMock.db)
)

export const dbChainMockFns = {
  select,
  selectDistinct,
  selectDistinctOn,
  from,
  where,
  limit,
  offset,
  orderBy,
  returning,
  innerJoin,
  leftJoin,
  groupBy,
  having,
  execute,
  for: forClause,
  insert,
  values,
  onConflictDoUpdate,
  onConflictDoNothing,
  update,
  set,
  delete: del,
  transaction,
}

/**
 * Re-applies the default chain wiring to every `dbChainMockFns` entry. Call
 * this in `beforeEach` (after `vi.clearAllMocks()`) if any test uses
 * `mockReturnValue` / `mockResolvedValue` (permanent overrides) — this
 * guarantees the next test starts with fresh defaults.
 *
 * Not needed if tests exclusively use the `...Once` variants, since those
 * auto-expire after one call.
 */
export function resetDbChainMock(): void {
  select.mockImplementation(() => ({ from }))
  selectDistinct.mockImplementation(() => ({ from }))
  selectDistinctOn.mockImplementation(() => ({ from }))
  from.mockImplementation(joinBuilder)
  innerJoin.mockImplementation(joinBuilder)
  leftJoin.mockImplementation(joinBuilder)
  where.mockImplementation(whereBuilder)
  insert.mockImplementation(() => ({ values }))
  values.mockImplementation(() => ({ returning, onConflictDoUpdate, onConflictDoNothing }))
  onConflictDoUpdate.mockImplementation(() => ({ returning }) as unknown as Promise<void>)
  onConflictDoNothing.mockImplementation(() => ({ returning }) as unknown as Promise<void>)
  update.mockImplementation(() => ({ set }))
  set.mockImplementation(() => ({ where }))
  del.mockImplementation(() => ({ where }))
  limit.mockImplementation(limitBuilder)
  offset.mockImplementation(() => Promise.resolve([] as unknown[]))
  orderBy.mockImplementation(terminalBuilder)
  returning.mockImplementation(() => Promise.resolve([] as unknown[]))
  having.mockImplementation(terminalBuilder)
  groupBy.mockImplementation(() => {
    const builder = terminalBuilder()
    builder.having = having
    return builder
  })
  execute.mockImplementation(() => Promise.resolve([] as unknown[]))
  forClause.mockImplementation(forBuilder)
  transaction.mockImplementation(async (cb: (tx: typeof dbChainMock.db) => unknown) =>
    cb(dbChainMock.db)
  )
}

/**
 * Static mock module for `@sim/db` backed by `dbChainMockFns`.
 *
 * @example
 * ```ts
 * vi.mock('@sim/db', () => dbChainMock)
 * ```
 */
const dbChainInstance = {
  select,
  selectDistinct,
  selectDistinctOn,
  insert,
  update,
  delete: del,
  execute,
  transaction,
}

export const dbChainMock = {
  db: dbChainInstance,
  /** Same instance as `db` so per-test chain overrides cover both clients. */
  dbReplica: dbChainInstance,
  runOutsideTransactionContext: <T>(fn: () => T): T => fn(),
  instrumentPoolClient: <T>(client: T): T => client,
}

/**
 * Creates a mock database connection.
 */
export function createMockDb() {
  // A `where(...)` result that is both awaitable (resolves to `[]`) and exposes
  // `.limit`/`.orderBy`, so `select().from()[.leftJoin()].where()[.limit()]`
  // works whether or not a terminal is chained.
  const whereResult = () => {
    const thenable: any = Promise.resolve([])
    thenable.limit = vi.fn(() => Promise.resolve([]))
    thenable.orderBy = vi.fn(() => Promise.resolve([]))
    return thenable
  }
  const fromBuilder = () => ({
    where: vi.fn(whereResult),
    leftJoin: vi.fn(() => ({ where: vi.fn(whereResult) })),
    innerJoin: vi.fn(() => ({ where: vi.fn(whereResult) })),
  })

  return {
    select: vi.fn(() => ({
      from: vi.fn(fromBuilder),
    })),
    selectDistinct: vi.fn(() => ({
      from: vi.fn(fromBuilder),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([])),
        onConflictDoUpdate: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([])),
        })),
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([])),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([])),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([])),
      })),
    })),
    transaction: vi.fn(async (callback) => callback(createMockDb())),
    query: vi.fn(() => Promise.resolve([])),
  }
}

/**
 * Mock module for @sim/db.
 * Use with vi.mock() to replace the real database.
 *
 * @example
 * ```ts
 * vi.mock('@sim/db', () => databaseMock)
 * ```
 */
const mockDbInstance = createMockDb()

export const databaseMock = {
  db: mockDbInstance,
  /** Same instance as `db` so per-test overrides cover both clients. */
  dbReplica: mockDbInstance,
  sql: createMockSql(),
  runOutsideTransactionContext: <T>(fn: () => T): T => fn(),
  instrumentPoolClient: <T>(client: T): T => client,
  ...createMockSqlOperators(),
}

/**
 * Creates a mock for drizzle-orm module.
 *
 * @example
 * ```ts
 * vi.mock('drizzle-orm', () => drizzleOrmMock)
 * ```
 */
export const drizzleOrmMock = {
  sql: createMockSql(),
  ...createMockSqlOperators(),
}
