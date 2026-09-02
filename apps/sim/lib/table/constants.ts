/**
 * Limits and constants for user-defined tables.
 */

import { randomInt, randomItem } from '@sim/utils/random'
import { env, envNumber } from '@/lib/core/config/env'

/**
 * Maximum tables addressable by identifier in one bulk request. Matches the
 * knowledge domain's `MAX_KNOWLEDGE_BATCH_ITEMS` so a multi-select on either
 * list page is capped the same way.
 */
export const MAX_TABLE_BATCH_ITEMS = 100

export const DEFAULT_TABLE_VIEW_NAME = 'Default'

export const TABLE_LIMITS = {
  MAX_TABLES_PER_WORKSPACE: 100,
  MAX_ROWS_PER_TABLE: 10000,
  MAX_ROW_SIZE_BYTES: 400 * 1024, // 400KB
  MAX_COLUMNS_PER_TABLE: 1000,
  MAX_TABLE_NAME_LENGTH: 128,
  MAX_COLUMN_NAME_LENGTH: 50,
  MAX_DESCRIPTION_LENGTH: 500,
  DEFAULT_QUERY_LIMIT: 100,
  MAX_QUERY_LIMIT: 1000,
  /**
   * Byte budget for one query response. `queryRows` drains rows in bounded
   * batches; an UNBOUNDED query (no limit) that outgrows the budget fails fast
   * (the whole result was promised — a partial page would be silent truncation),
   * while a BOUNDED page cuts early and returns the partial list with
   * `nextCursor` set. At least one row is always returned on a bounded page.
   * Measured against serialized row `data` only, not the full HTTP envelope.
   */
  MAX_QUERY_RESULT_BYTES: 5 * 1024 * 1024, // 5MB
  /** Hard row cap per internal fetch batch inside queryRows' bounded drain loop. */
  QUERY_BATCH_MAX_ROWS: 10000,
  /** Batch size for bulk update operations */
  UPDATE_BATCH_SIZE: 100,
  /** Batch size for bulk delete operations */
  DELETE_BATCH_SIZE: 1000,
  /**
   * Serialized row-data budget for one committed delete snapshot batch. Batch
   * deletes measure stored JSONB bytes while holding row locks and stop at this
   * budget. A historical row already larger than the budget is deleted alone
   * and logged; current writes cannot create another because row admission is
   * capped at the same value.
   */
  DELETE_SNAPSHOT_BATCH_MAX_BYTES: 32 * 1024 * 1024,
  /** Maximum rows per batch insert */
  MAX_BATCH_INSERT_SIZE: 1000,
  /** Maximum rows per bulk update/delete operation */
  MAX_BULK_OPERATION_SIZE: 1000,
  /** Maximum rows a single clipboard copy/cut serializes; beyond this the user is steered to Export. */
  MAX_COPY_ROWS: 50000,
  /** Rows selected + deleted per page in the async background delete-job loop. Each
   *  DELETE_BATCH_SIZE chunk inside the page commits in its own transaction; the page is the
   *  keyset-select and cancel/ownership-check granularity. */
  DELETE_PAGE_SIZE: 10000,
  /** Row count above which an export runs as a background job instead of a synchronous stream.
   *  Tables at or under this stream instantly; larger ones fall back to an async export job. */
  EXPORT_ASYNC_THRESHOLD_ROWS: 10000,
  /** Cap on the exclusion set ("select all, minus these") sent to an async delete job. */
  MAX_EXCLUDE_ROW_IDS: 10000,
  /**
   * Byte budget for the per-row run-state sidecar a read may materialize when
   * it opts in. `blockErrors` is unbounded jsonb, so a full page of rows times
   * a group each has no ceiling of its own. A read past the budget is refused
   * (413) rather than silently truncated — a partial answer to "which of my
   * rows errored" is a wrong answer.
   */
  MAX_ROW_RUN_STATE_BYTES: 2 * 1024 * 1024,
  /**
   * Matching cells one Find returns. The scan fetches one extra to decide
   * `truncated`; matches carry no cursor, so a caller past the cap narrows its
   * predicate instead of paging. Published in the response contract — a cap a
   * caller cannot see is a cap it cannot plan around.
   */
  MAX_FIND_MATCHES: 1000,
  /**
   * Saved views per table. The views list is a single unpaginated full-set read
   * (`GET /tables/{id}/views` always answers `nextCursor: null`), so the write
   * side is what keeps that set small — the same shape as the folder cap, which
   * bounds every reader that materializes a workspace's folder tree.
   */
  MAX_VIEWS_PER_TABLE: 100,
  /**
   * Workflow/enrichment groups per table. Same reason as
   * {@link TABLE_LIMITS.MAX_VIEWS_PER_TABLE}: `GET /tables/{id}/groups` is a
   * full-set read that always answers `nextCursor: null`, so its published
   * "bounded set" claim is only true if the write side keeps it true. The
   * indirect bound (every group must add at least one output column, and
   * columns are capped) does not survive an update path that adds no columns.
   */
  MAX_WORKFLOW_GROUPS_PER_TABLE: 100,
} as const

/**
 * Default plan-based table limits. Each value can be overridden via env vars
 * (see `getTablePlanLimits`). Billing-disabled deployments are unlimited
 * unless the free-tier env vars are explicitly set (see
 * `getBillingDisabledTableLimits`).
 */
export const DEFAULT_TABLE_PLAN_LIMITS = {
  free: {
    maxTables: 5,
    maxRowsPerTable: 50000,
  },
  pro: {
    maxTables: 100,
    maxRowsPerTable: 100000,
  },
  team: {
    maxTables: 1000,
    maxRowsPerTable: 500000,
  },
  enterprise: {
    maxTables: 10000,
    maxRowsPerTable: 1000000,
  },
} as const

/**
 * Explicit row ids one column run may target. The largest table any plan allows
 * is the ceiling: a longer list necessarily names rows that do not exist, and
 * the run command rejects it. Declared on the request contract so the refusal
 * is a documented bound rather than a surprise from the domain.
 */
export const MAX_RUN_TARGET_ROW_IDS = DEFAULT_TABLE_PLAN_LIMITS.enterprise.maxRowsPerTable

/**
 * Byte budget at which a **bounded** page (one with an explicit `limit`) is cut
 * short. Defaults to the 5MB query-result budget and can be overridden with
 * `TABLE_MAX_PAGE_BYTES`. Callers must terminate on `nextCursor === null`, not
 * page fullness, because a byte-limited page may contain fewer rows than requested.
 *
 * Unbounded queries (no `limit`) are unaffected by the override — they always
 * fail fast at `TABLE_LIMITS.MAX_QUERY_RESULT_BYTES` rather than return a partial
 * result.
 */
export function getMaxPageBytes(): number {
  return envNumber(env.TABLE_MAX_PAGE_BYTES, TABLE_LIMITS.MAX_QUERY_RESULT_BYTES, {
    min: 1,
    integer: true,
  })
}

/**
 * Maximum serialized size in bytes of a single row. Defaults to
 * `TABLE_LIMITS.MAX_ROW_SIZE_BYTES`; overridable via the
 * `TABLE_MAX_ROW_SIZE_BYTES` env var (server-only, read at call time), capped
 * at the delete snapshot budget so every accepted row fits in one batch.
 */
export function getMaxRowSizeBytes(): number {
  return Math.min(
    envNumber(env.TABLE_MAX_ROW_SIZE_BYTES, TABLE_LIMITS.MAX_ROW_SIZE_BYTES, {
      min: 1,
      integer: true,
    }),
    TABLE_LIMITS.DELETE_SNAPSHOT_BATCH_MAX_BYTES
  )
}

/**
 * Initial row-count cap for a delete snapshot batch. Delete paths additionally
 * measure the selected rows as stored and shorten each transaction to the byte
 * budget; this count avoids scanning more candidate ids than current writes can
 * possibly fit.
 */
export function getDeleteSnapshotBatchSize(): number {
  return Math.max(
    1,
    Math.min(
      TABLE_LIMITS.DELETE_BATCH_SIZE,
      Math.floor(TABLE_LIMITS.DELETE_SNAPSHOT_BATCH_MAX_BYTES / getMaxRowSizeBytes())
    )
  )
}

export type PlanName = keyof typeof DEFAULT_TABLE_PLAN_LIMITS

export interface TablePlanLimits {
  maxTables: number
  maxRowsPerTable: number
}

/**
 * Table limits for billing-disabled deployments: unlimited by default, with
 * each cap opting back in only when its free-tier env var is explicitly set
 * to a valid positive integer.
 */
export function getBillingDisabledTableLimits(): TablePlanLimits {
  const tablesOverride = envNumber(env.FREE_TABLES_LIMIT, 0, { min: 1, integer: true })
  const rowsOverride = envNumber(env.FREE_TABLE_ROWS_LIMIT, 0, { min: 1, integer: true })
  return {
    maxTables: tablesOverride > 0 ? tablesOverride : Number.MAX_SAFE_INTEGER,
    maxRowsPerTable: rowsOverride > 0 ? rowsOverride : Number.MAX_SAFE_INTEGER,
  }
}

export type TablePlanLimitsByPlan = Record<PlanName, TablePlanLimits>

/**
 * Returns plan-based table limits, applying env var overrides on top of the
 * defaults. When no override is set the value falls back to the hosted-default
 * constant so behavior is unchanged for the hosted product.
 */
export function getTablePlanLimits(): TablePlanLimitsByPlan {
  return {
    free: {
      maxTables: envNumber(env.FREE_TABLES_LIMIT, DEFAULT_TABLE_PLAN_LIMITS.free.maxTables),
      maxRowsPerTable: envNumber(
        env.FREE_TABLE_ROWS_LIMIT,
        DEFAULT_TABLE_PLAN_LIMITS.free.maxRowsPerTable
      ),
    },
    pro: {
      maxTables: envNumber(env.PRO_TABLES_LIMIT, DEFAULT_TABLE_PLAN_LIMITS.pro.maxTables),
      maxRowsPerTable: envNumber(
        env.PRO_TABLE_ROWS_LIMIT,
        DEFAULT_TABLE_PLAN_LIMITS.pro.maxRowsPerTable
      ),
    },
    team: {
      maxTables: envNumber(env.TEAM_TABLES_LIMIT, DEFAULT_TABLE_PLAN_LIMITS.team.maxTables),
      maxRowsPerTable: envNumber(
        env.TEAM_TABLE_ROWS_LIMIT,
        DEFAULT_TABLE_PLAN_LIMITS.team.maxRowsPerTable
      ),
    },
    enterprise: {
      maxTables: envNumber(
        env.ENTERPRISE_TABLES_LIMIT,
        DEFAULT_TABLE_PLAN_LIMITS.enterprise.maxTables
      ),
      maxRowsPerTable: envNumber(
        env.ENTERPRISE_TABLE_ROWS_LIMIT,
        DEFAULT_TABLE_PLAN_LIMITS.enterprise.maxRowsPerTable
      ),
    },
  }
}

/**
 * Re-exported from the column-type module, which is the single source of truth.
 * Kept here because this is where callers already import it from — restating
 * the list would let the two drift, which is the class of bug the registry
 * exists to remove.
 *
 * Points at `types` rather than `registry` on purpose: this module is re-
 * exported by the `@/lib/table` barrel that 44 server modules import, and the
 * registry pulls in `@sim/emcn/icons`.
 */
export { COLUMN_TYPES } from '@/lib/table/column-types/types'

/** Maximum number of options a `select`/`multiselect` column may declare. */
export const MAX_SELECT_OPTIONS = 100

/**
 * The v2 filter operators, as a runtime tuple so both the `FilterOp` type and
 * the boundary Zod enum derive from one source. Order is not significant.
 */
export const FILTER_OPS = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'nin',
  'contains',
  'ncontains',
  'startsWith',
  'endsWith',
  'like',
  'ilike',
  'nlike',
  'nilike',
  'isEmpty',
  'isNotEmpty',
  'isNull',
  'isNotNull',
] as const

export const SORT_DIRECTIONS = ['asc', 'desc'] as const

/**
 * Identifier rule for table names, column names, and JSONB filter fields:
 * an ASCII letter or underscore, then letters, digits, or underscores.
 *
 * Spelled with an explicit `A-Za-z` class and NO `i` flag on purpose. This
 * source is published verbatim as a JSON Schema `pattern` in the v2 OpenAPI
 * documents, and JSON Schema patterns carry no flags — a `/^[a-z_][a-z0-9_]*$/i`
 * spelling round-trips as the case-SENSITIVE `^[a-z_][a-z0-9_]*$`, so every
 * generated client would reject names the server accepts (`Sales`,
 * `subscriptionPlan`). The two spellings match exactly the same strings at
 * runtime; only the published form differs.
 */
export const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export const USER_TABLE_ROWS_SQL_NAME = 'user_table_rows'

/**
 * CSV/TSV uploads at or above this size import in the background (direct-to-storage
 * upload + async worker) instead of being POSTed through the server. Kept safely under
 * the Next.js proxy request-body cap (10MB) so a synchronous upload is never truncated.
 */
export const CSV_ASYNC_IMPORT_THRESHOLD_BYTES = 8 * 1024 * 1024

const TABLE_NAME_ADJECTIVES = [
  'Radiant',
  'Luminous',
  'Blazing',
  'Glowing',
  'Bright',
  'Gleaming',
  'Shining',
  'Lustrous',
  'Vivid',
  'Dazzling',
  'Stellar',
  'Cosmic',
  'Astral',
  'Galactic',
  'Nebular',
  'Orbital',
  'Lunar',
  'Solar',
  'Starlit',
  'Celestial',
  'Infinite',
  'Vast',
  'Boundless',
  'Immense',
  'Colossal',
  'Titanic',
  'Grand',
  'Supreme',
  'Eternal',
  'Ancient',
  'Timeless',
  'Primal',
  'Nascent',
  'Elder',
  'Swift',
  'Drifting',
  'Surging',
  'Pulsing',
  'Soaring',
  'Rising',
  'Spiraling',
  'Crimson',
  'Azure',
  'Violet',
  'Indigo',
  'Amber',
  'Sapphire',
  'Obsidian',
  'Silver',
  'Golden',
  'Scarlet',
  'Cobalt',
  'Emerald',
  'Magnetic',
  'Quantum',
  'Photonic',
  'Spectral',
  'Charged',
  'Atomic',
  'Electric',
  'Kinetic',
  'Ethereal',
  'Mystic',
  'Phantom',
  'Silent',
  'Distant',
  'Hidden',
  'Arcane',
  'Frozen',
  'Burning',
  'Molten',
  'Volatile',
  'Fiery',
  'Searing',
  'Frigid',
  'Mighty',
  'Fierce',
  'Serene',
  'Tranquil',
  'Harmonic',
  'Resonant',
  'Bold',
  'Noble',
  'Pure',
  'Rare',
  'Pristine',
  'Exotic',
  'Divine',
] as const

const TABLE_NAME_NOUNS = [
  'Star',
  'Pulsar',
  'Quasar',
  'Magnetar',
  'Nova',
  'Supernova',
  'Neutron',
  'Protostar',
  'Blazar',
  'Cepheid',
  'Galaxy',
  'Nebula',
  'Cluster',
  'Void',
  'Filament',
  'Halo',
  'Spiral',
  'Remnant',
  'Cloud',
  'Planet',
  'Moon',
  'World',
  'Exoplanet',
  'Titan',
  'Europa',
  'Triton',
  'Enceladus',
  'Comet',
  'Meteor',
  'Asteroid',
  'Fireball',
  'Shard',
  'Fragment',
  'Orion',
  'Andromeda',
  'Perseus',
  'Pegasus',
  'Phoenix',
  'Draco',
  'Cygnus',
  'Aquila',
  'Lyra',
  'Vega',
  'Hydra',
  'Sirius',
  'Polaris',
  'Altair',
  'Eclipse',
  'Aurora',
  'Corona',
  'Flare',
  'Vortex',
  'Pulse',
  'Wave',
  'Ripple',
  'Shimmer',
  'Spark',
  'Horizon',
  'Zenith',
  'Apex',
  'Meridian',
  'Equinox',
  'Solstice',
  'Transit',
  'Orbit',
  'Cosmos',
  'Dimension',
  'Realm',
  'Expanse',
  'Infinity',
  'Continuum',
  'Abyss',
  'Ether',
  'Photon',
  'Neutrino',
  'Tachyon',
  'Graviton',
  'Sector',
  'Quadrant',
  'Belt',
  'Ring',
  'Field',
  'Stream',
  'Frontier',
  'Beacon',
  'Signal',
  'Probe',
  'Voyager',
  'Pioneer',
  'Sentinel',
  'Gateway',
  'Portal',
  'Nexus',
  'Conduit',
  'Rift',
  'Core',
  'Matrix',
  'Lattice',
  'Array',
  'Reactor',
  'Engine',
  'Forge',
  'Crucible',
] as const

/**
 * Generates a unique space-themed table name that doesn't collide with existing names.
 * Uses lowercase with underscores to satisfy NAME_PATTERN validation.
 */
export function generateUniqueTableName(existingNames: string[]): string {
  const taken = new Set(existingNames.map((n) => n.toLowerCase()))
  const maxAttempts = 50

  for (let i = 0; i < maxAttempts; i++) {
    const adj = randomItem(TABLE_NAME_ADJECTIVES)
    const noun = randomItem(TABLE_NAME_NOUNS)
    const name = `${adj.toLowerCase()}_${noun.toLowerCase()}`
    if (!taken.has(name)) return name
  }

  const adj = randomItem(TABLE_NAME_ADJECTIVES)
  const noun = randomItem(TABLE_NAME_NOUNS)
  const suffix = randomInt(100, 1000)
  return `${adj.toLowerCase()}_${noun.toLowerCase()}_${suffix}`
}
