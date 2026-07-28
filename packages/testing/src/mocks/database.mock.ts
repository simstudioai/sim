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

  sqlFn.raw = (rawSql: string) => ({
    rawSql,
    toSQL: () => ({ sql: rawSql, params: [] }),
  })

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
    notLike: vi.fn((column, pattern) => ({ type: 'notLike', column, pattern })),
    ilike: vi.fn((column, pattern) => ({ type: 'ilike', column, pattern })),
    notIlike: vi.fn((column, pattern) => ({ type: 'notIlike', column, pattern })),
    desc: vi.fn((column) => ({ type: 'desc', column })),
    asc: vi.fn((column) => ({ type: 'asc', column })),
  }
}

/**
 * Table-routed result queues.
 *
 * `queueTableRows(schemaMock.member, [rowA, rowB])` enqueues one result set for
 * the next select chain whose `.from()` (or a subsequent `innerJoin`/
 * `leftJoin`) references that table. Each chain consumes at most one queued
 * set (FIFO per table, `.from()` table checked before join tables); chains
 * against tables with no queued sets resolve the chain-fn defaults (empty
 * array). Mutation chains (`update`/`delete`/`insert`) never consume select
 * queues. Queues are cleared by `resetDbChainMock()`.
 *
 * The queue is keyed by table object identity, so pass the same schema-mock
 * table object the code under test passes to `.from()` / the join.
 *
 * Footgun: because a chain falls back to its JOIN tables when the `.from()`
 * table has nothing queued, a `from(A).innerJoin(B)` chain you expect to
 * resolve empty will consume a set queued for a LATER select on `B`. When a
 * suite queues `B` for a subsequent query, queue an explicit empty set on `A`
 * first (`queueTableRows(A, [])`) so the joined chain consumes that instead.
 */
const tableRowQueues = new Map<unknown, unknown[][]>()

/**
 * Enqueues one result set for the next select chain reading `table`.
 */
export function queueTableRows(table: unknown, rows: unknown[]): void {
  const queue = tableRowQueues.get(table)
  if (queue) queue.push(rows)
  else tableRowQueues.set(table, [rows])
}

/** Dequeues the first queued set among the given chain's tables (from before joins). */
function dequeueChainRows(tables: unknown[]): unknown[] | null {
  for (const table of tables) {
    const queue = tableRowQueues.get(table)
    if (queue && queue.length > 0) return queue.shift() ?? null
  }
  return null
}

/**
 * Pre-wired chain of vi.fn()s for drizzle-style DB queries.
 *
 * Each chain step is recorded on a stable, module-level `vi.fn()` spy
 * (`dbChainMockFns.*`) — safe to reference inside hoisted `vi.mock()`
 * factories (same pattern as `authMockFns`):
 *
 * - `select().from().where()` → returns a builder with `.limit` / `.orderBy` /
 *   `.returning` / `.groupBy` / `.for` terminals
 * - `select().from().innerJoin()|leftJoin()` → returns the same where-builder
 * - `insert().values().returning()` / `update().set().where()` / `delete().where()`
 *
 * Results resolve, in priority order:
 * 1. a per-test override (`dbChainMockFns.limit.mockResolvedValueOnce([...])`)
 * 2. rows queued for one of the chain's tables via `queueTableRows`
 * 3. the default empty array
 *
 * Routing state lives in per-chain closures: each `select().from(t)` captures
 * its own table list, so partially-built chains for different tables can be
 * interleaved or awaited in any order without cross-talk. The shared spies
 * carry only call history and per-test overrides — a spy's default
 * implementation returns a sentinel that the chain replaces with the
 * chain-local builder, while any `mock*` override on the spy wins verbatim.
 *
 * `for` mirrors drizzle's `.for('update')` — it returns a Promise with
 * `.limit` / `.orderBy` / `.returning` / `.groupBy` attached, so both
 * `await .where().for('update')` (terminal) and
 * `await .where().for('update').limit(1)` (chained) work.
 *
 * `vi.clearAllMocks()` clears call history but preserves default wiring. Tests
 * that replace a wiring with `mockReturnValue(...)` (not `...Once`) must
 * re-wire via `resetDbChainMock()` in their own `beforeEach`.
 *
 * @example
 * ```ts
 * import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
 *
 * beforeEach(() => {
 *   vi.clearAllMocks()
 *   resetDbChainMock()
 * })
 *
 * it('finds rows', async () => {
 *   queueTableRows(schemaMock.workflow, [{ id: 'w-1' }])
 *   // ... exercise code that hits db.select().from(workflow).where() ...
 *   expect(dbChainMockFns.where).toHaveBeenCalled()
 * })
 * ```
 */
const CHAIN_DEFAULT = Symbol('db-chain-default')

type ChainSpy = ReturnType<typeof vi.fn<(...args: any[]) => any>>

const chainSpy = (): ChainSpy => vi.fn((..._args: any[]) => CHAIN_DEFAULT as any)

/**
 * Records the call on the shared spy, honoring any per-test override; when the
 * spy still has its default implementation, builds the chain-local default.
 */
const spyOrDefault = (spy: ChainSpy, buildDefault: (...args: any[]) => unknown) =>
  vi.fn((...args: any[]) => {
    const result = spy(...args)
    return result === CHAIN_DEFAULT ? buildDefault(...args) : result
  })

// Shared spies: structural steps default to the sentinel (chain-local builders
// take over); value terminals keep real defaults.
const select = chainSpy()
const selectDistinct = chainSpy()
const selectDistinctOn = chainSpy()
const from = chainSpy()
const where = chainSpy()
const limit = chainSpy()
const offset = chainSpy()
const orderBy = chainSpy()
const groupBy = chainSpy()
const having = chainSpy()
const forClause = chainSpy()
const innerJoin = chainSpy()
const leftJoin = chainSpy()
const insert = chainSpy()
const update = chainSpy()
const set = chainSpy()
const del = chainSpy()
const returning = vi.fn(() => Promise.resolve([] as unknown[]))
const execute = vi.fn(() => Promise.resolve([] as unknown[]))
const query = vi.fn(() => Promise.resolve([] as unknown[]))
const onConflictDoUpdate = vi.fn(() => ({ returning }) as unknown as Promise<void>)
const onConflictDoNothing = vi.fn(() => ({ returning }) as unknown as Promise<void>)
const values = vi.fn(() => ({ returning, onConflictDoUpdate, onConflictDoNothing }))
const transaction: ReturnType<typeof vi.fn> = vi.fn(
  async (cb: (tx: any) => unknown): Promise<unknown> => cb(dbChainMock.db)
)

/**
 * Lazy per-chain rows supplier: dequeues once, at the moment the FIRST default
 * thenable actually resolves. A chain whose result comes from a per-test
 * override never reaches a default resolution, so its queued set stays
 * available for the next chain on that table.
 */
type RowsSupplier = () => unknown[] | null

const chainRowsSupplier = (tables: unknown[]): RowsSupplier => {
  let consumed = false
  let rows: unknown[] | null = null
  return () => {
    if (!consumed) {
      consumed = true
      rows = dequeueChainRows(tables)
    }
    return rows
  }
}

const noRows: RowsSupplier = () => null

/** An awaitable chain step that resolves `getRows()` only when actually awaited. */
const lazyRowsThenable = (getRows: RowsSupplier): any => ({
  then: (onFulfilled?: (rows: unknown[]) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve((getRows() ?? []) as unknown[]).then(onFulfilled, onRejected),
  catch: (onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve((getRows() ?? []) as unknown[]).catch(onRejected),
  finally: (onFinally?: () => void) =>
    Promise.resolve((getRows() ?? []) as unknown[]).finally(onFinally),
})

// `.limit()` returns a builder that is awaitable and also exposes `.offset()`
// for keyset/OFFSET paging (`.limit(n).offset(m)`) and `.for()` for drizzle's
// `.limit(1).for('update')` row-lock form.
const limitBuilder = (getRows: RowsSupplier) => {
  const thenable = lazyRowsThenable(getRows)
  thenable.offset = spyOrDefault(offset, () => lazyRowsThenable(getRows))
  thenable.for = spyOrDefault(forClause, () => limitBuilder(getRows))
  return thenable
}

const terminalBuilder = (getRows: RowsSupplier): any => {
  const thenable = lazyRowsThenable(getRows)
  thenable.limit = spyOrDefault(limit, () => limitBuilder(getRows))
  thenable.orderBy = spyOrDefault(orderBy, () => terminalBuilder(getRows))
  thenable.returning = returning
  thenable.groupBy = spyOrDefault(groupBy, () => {
    const builder = terminalBuilder(getRows)
    builder.having = spyOrDefault(having, () => terminalBuilder(getRows))
    return builder
  })
  thenable.for = spyOrDefault(forClause, () => terminalBuilder(getRows))
  return thenable
}

// The from/join builder is itself a thenable so `await db.select().from(t)`
// (no where clause) also resolves table-routed rows; the chain's single lazy
// supplier means it never double-consumes no matter which step is awaited.
const joinBuilder = (tables: unknown[]): any => {
  const getRows = chainRowsSupplier(tables)
  const builder = lazyRowsThenable(getRows)
  builder.where = spyOrDefault(where, () => terminalBuilder(getRows))
  builder.innerJoin = spyOrDefault(innerJoin, (table: unknown) => joinBuilder([...tables, table]))
  builder.leftJoin = spyOrDefault(leftJoin, (table: unknown) => joinBuilder([...tables, table]))
  return builder
}

const selectBuilder = () => ({
  from: spyOrDefault(from, (table: unknown) => joinBuilder([table])),
})

// Mutation chains route nothing: their where() resolves the plain default so a
// mutation can never consume rows queued for a select.
const mutationWhere = () => ({
  where: spyOrDefault(where, () => terminalBuilder(noRows)),
})

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
 * Restores every `dbChainMockFns` entry to its default wiring, drains any
 * unconsumed `...Once` overrides, and clears all table-routed row queues.
 * Call this in `beforeEach` (after `vi.clearAllMocks()`) so each test starts
 * from fresh defaults — a `...Once` override queued by a previous test but
 * never consumed would otherwise leak into the next test (`vi.clearAllMocks`
 * clears call history only, not once-queues).
 */
export function resetDbChainMock(): void {
  tableRowQueues.clear()
  // mockReset restores the implementation passed to vi.fn() (the sentinel for
  // structural spies, the real defaults for value terminals) AND drains any
  // unconsumed ...Once overrides — covering the shared spies and the stable
  // db-instance wrappers alike.
  for (const spy of Object.values(dbChainMockFns)) {
    ;(spy as ChainSpy).mockReset()
  }
  query.mockReset()
  for (const key of [
    'select',
    'selectDistinct',
    'selectDistinctOn',
    'insert',
    'update',
    'delete',
  ] as const) {
    ;(dbInstance[key] as ChainSpy).mockReset()
  }
}

/**
 * The single shared `@sim/db` mock instance backing BOTH `dbChainMock` and
 * `databaseMock`. Because every binding resolves to the same chain spies, a
 * module bound to either export behaves identically — there is exactly one
 * db-mock state to configure and reset.
 */
const dbInstance = {
  select: spyOrDefault(select, selectBuilder),
  selectDistinct: spyOrDefault(selectDistinct, selectBuilder),
  selectDistinctOn: spyOrDefault(selectDistinctOn, selectBuilder),
  insert: spyOrDefault(insert, () => ({ values })),
  update: spyOrDefault(update, () => ({ set: spyOrDefault(set, mutationWhere) })),
  delete: spyOrDefault(del, mutationWhere),
  execute,
  query,
  transaction,
}

/**
 * Static mock module for `@sim/db` backed by `dbChainMockFns`.
 *
 * @example
 * ```ts
 * vi.mock('@sim/db', () => dbChainMock)
 * ```
 */
export const dbChainMock = {
  db: dbInstance,
  /** Same instance as `db` so per-test chain overrides cover both clients. */
  dbReplica: dbInstance,
  /** Sub-pool clients (`dbFor('cleanup' | 'exec')`) share the same instance too. */
  dbFor: () => dbInstance,
  runOutsideTransactionContext: <T>(fn: () => T): T => fn(),
  instrumentPoolClient: <T>(client: T): T => client,
}

/**
 * Mock module for `@sim/db` installed globally in vitest.setup.ts. Shares its
 * `db` instance (and therefore all chain spies and table queues) with
 * `dbChainMock`; additionally exposes the `sql` template tag and operator
 * exports the real module provides.
 *
 * @example
 * ```ts
 * vi.mock('@sim/db', () => databaseMock)
 * ```
 */
export const databaseMock = {
  ...dbChainMock,
  sql: createMockSql(),
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
  /** Mirrors drizzle's getTableColumns for schema-mock tables (column-name maps). */
  getTableColumns: vi.fn((table: Record<string, unknown>) => ({ ...table })),
  ...createMockSqlOperators(),
}
