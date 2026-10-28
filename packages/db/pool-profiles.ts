/** Per-process budgets; total database connections also depend on the number of processes. */
export const DB_POOL_PROFILES = {
  web: { primaryMax: 10, replicaMax: 4, appName: 'sim-app' },
  /** One run can need parallel queries and overlapping logging writes. */
  trigger: { primaryMax: 5, replicaMax: 2, appName: 'sim-trigger' },
  realtime: { primaryMax: 5, replicaMax: 3, appName: 'sim-realtime' },
  /** Sub-process pools are selected per call site through dbFor(). */
  cleanup: { primaryMax: 5, replicaMax: 2, appName: 'sim-cleanup' },
  exec: { primaryMax: 10, replicaMax: 4, appName: 'sim-exec' },
  search: { primaryMax: 5, replicaMax: 0, appName: 'sim-search' },
  /**
   * Usage-ledger writes and threshold settlements: short transactions bounded by
   * server-side timeouts, so they must never queue behind slow reads on the process
   * pool, where postgres.js pipelines new work onto busy connections.
   */
  billing: { primaryMax: 4, replicaMax: 0, appName: 'sim-billing' },
  /** Session, adapter, and API-key lookups that gate every authenticated request. */
  auth: { primaryMax: 3, replicaMax: 0, appName: 'sim-auth' },
} as const
