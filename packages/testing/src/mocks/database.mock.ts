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
    ilike: vi.fn((column, pattern) => ({ type: 'ilike', column, pattern })),
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
 * array). Queues are cleared by `resetDbChainMock()`.
 *
 * The queue is keyed by table object identity, so pass the same schema-mock
 * table object the code under test passes to `.from()` / the join.
 *
 * Routing assumes each select chain is built left-to-right before the next
 * chain starts — the norm for code under test (`Promise.all` over fully-built
 * chains is fine; interleaving *construction* of two chains is not). Mutation
 * chains (`update`/`delete`/`insert`) never consume select queues.
 */
const tableRowQueues = new Map<unknown, unknown[][]>()

/** Tables of the select chain currently being built: `.from()` first, then joins. */
let activeTables: unknown[] = []

/** Rows dequeued for the current chain, shared by every downstream terminal. */
let activeRows: unknown[] | null = null

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
 * Each builder step is a stable, module-level `vi.fn()` — safe to reference
 * inside hoisted `vi.mock()` factories (same pattern as `authMockFns`). Chains
 * are wired at module load time:
 *
 * - `select().from().where()` → returns a builder with `.limit` / `.orderBy` /
 *   `.returning` / `.groupBy` / `.for` terminals
 * - `select().from().innerJoin()|leftJoin()` → returns the same where-builder
 * - `insert().values().returning()` / `update().set().where()` / `delete().where()`
 *
 * Results resolve, in priority order:
 * 1. a per-test override (`dbChainMockFns.limit.mockResolvedValueOnce([...])`)
 * 2. rows queued for the chain's `.from()` table via `queueTableRows`
 * 3. the default empty array
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
 * import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
 * import { schemaMock } from '@sim/testing'
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
const chainRows = () => Promise.resolve((activeRows ?? []) as unknown[])

const offset = vi.fn(chainRows)
// `.limit()` returns a builder that is awaitable and also exposes `.offset()`
// for keyset/OFFSET paging (`.limit(n).offset(m)`).
const limitBuilder = () => {
  const thenable: any = chainRows()
  thenable.offset = offset
  return thenable
}
const limit = vi.fn(limitBuilder)
const returning = vi.fn(() => Promise.resolve([] as unknown[]))
const execute = vi.fn(() => Promise.resolve([] as unknown[]))

const terminalBuilder = () => {
  const thenable: any = chainRows()
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
  // Dequeue table-routed rows when the where clause materializes; every
  // downstream terminal (limit/orderBy/...) then resolves the same rows.
  activeRows = dequeueChainRows(activeTables)
  // Some call sites await the where directly (no limit/orderBy), so the
  // builder is itself a thenable.
  const thenable: any = chainRows()
  thenable.limit = limit
  thenable.orderBy = orderBy
  thenable.returning = returning
  thenable.groupBy = groupBy
  thenable.for = forClause
  return thenable
}
const where = vi.fn(whereBuilder)

// The from/join builder is itself a thenable so `await db.select().from(t)`
// (no where clause) also resolves table-routed rows. Each builder closes over
// ITS chain's tables array, so builders constructed before an earlier one is
// awaited still route to their own chain. Dequeue happens lazily at await
// time, so a chain that continues into `.where()` never double-consumes.
const joinBuilder = (
  tables: unknown[]
): { where: typeof where; innerJoin: any; leftJoin: any; then: any } => ({
  where,
  innerJoin,
  leftJoin,
  then: (onFulfilled?: (rows: unknown[]) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve((dequeueChainRows(tables) ?? []) as unknown[]).then(onFulfilled, onRejected),
})
const joinStep = (table?: unknown) => {
  activeTables.push(table)
  return joinBuilder(activeTables)
}
const innerJoin: ReturnType<typeof vi.fn> = vi.fn(joinStep)
const leftJoin: ReturnType<typeof vi.fn> = vi.fn(joinStep)
const from = vi.fn((table?: unknown) => {
  activeTables = [table]
  activeRows = null
  return joinBuilder(activeTables)
})

const select = vi.fn(() => ({ from }))
const selectDistinct = vi.fn(() => ({ from }))
const selectDistinctOn = vi.fn(() => ({ from }))
const values = vi.fn(() => ({ returning, onConflictDoUpdate, onConflictDoNothing }))
const insert = vi.fn(() => ({ values }))
// Mutation chains clear the routing context so their `where()` never consumes
// rows queued for a select.
const mutationStep = <T>(next: T): T => {
  activeTables = []
  activeRows = null
  return next
}
const set = vi.fn(() => mutationStep({ where }))
const update = vi.fn(() => mutationStep({ set }))
const del = vi.fn(() => mutationStep({ where }))
const query = vi.fn(() => Promise.resolve([] as unknown[]))
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
 * Re-applies the default chain wiring to every `dbChainMockFns` entry and
 * clears all table-routed row queues. Call this in `beforeEach` (after
 * `vi.clearAllMocks()`) if any test uses `mockReturnValue` /
 * `mockResolvedValue` (permanent overrides) or `queueTableRows` — this
 * guarantees the next test starts with fresh defaults.
 *
 * Not needed if tests exclusively use the `...Once` variants, since those
 * auto-expire after one call.
 */
export function resetDbChainMock(): void {
  tableRowQueues.clear()
  activeTables = []
  activeRows = null
  select.mockImplementation(() => ({ from }))
  selectDistinct.mockImplementation(() => ({ from }))
  selectDistinctOn.mockImplementation(() => ({ from }))
  from.mockImplementation((table?: unknown) => {
    activeTables = [table]
    activeRows = null
    return joinBuilder(activeTables)
  })
  innerJoin.mockImplementation(joinStep)
  leftJoin.mockImplementation(joinStep)
  where.mockImplementation(whereBuilder)
  insert.mockImplementation(() => ({ values }))
  values.mockImplementation(() => ({ returning, onConflictDoUpdate, onConflictDoNothing }))
  onConflictDoUpdate.mockImplementation(() => ({ returning }) as unknown as Promise<void>)
  onConflictDoNothing.mockImplementation(() => ({ returning }) as unknown as Promise<void>)
  update.mockImplementation(() => mutationStep({ set }))
  set.mockImplementation(() => mutationStep({ where }))
  del.mockImplementation(() => mutationStep({ where }))
  limit.mockImplementation(limitBuilder)
  offset.mockImplementation(chainRows)
  orderBy.mockImplementation(terminalBuilder)
  returning.mockImplementation(() => Promise.resolve([] as unknown[]))
  having.mockImplementation(terminalBuilder)
  groupBy.mockImplementation(() => {
    const builder = terminalBuilder()
    builder.having = having
    return builder
  })
  execute.mockImplementation(() => Promise.resolve([] as unknown[]))
  query.mockImplementation(() => Promise.resolve([] as unknown[]))
  forClause.mockImplementation(forBuilder)
  transaction.mockImplementation(async (cb: (tx: typeof dbChainMock.db) => unknown) =>
    cb(dbChainMock.db)
  )
}

/**
 * The single shared `@sim/db` mock instance backing BOTH `dbChainMock` and
 * `databaseMock`. Because every binding resolves to the same chain fns, a
 * module bound to either export behaves identically — there is exactly one
 * db-mock state to configure and reset.
 */
const dbInstance = {
  select,
  selectDistinct,
  selectDistinctOn,
  insert,
  update,
  delete: del,
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
 * `db` instance (and therefore all chain fns and table queues) with
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
