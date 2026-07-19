/**
 * Limits and constants for user-defined tables.
 */

import { randomInt, randomItem } from '@sim/utils/random'
import { env, envNumber } from '@/lib/core/config/env'

export const TABLE_LIMITS = {
  MAX_TABLES_PER_WORKSPACE: 100,
  MAX_ROWS_PER_TABLE: 10000,
  MAX_ROW_SIZE_BYTES: 400 * 1024, // 400KB
  MAX_COLUMNS_PER_TABLE: 50,
  MAX_TABLE_NAME_LENGTH: 128,
  MAX_COLUMN_NAME_LENGTH: 50,
  MAX_DESCRIPTION_LENGTH: 500,
  DEFAULT_QUERY_LIMIT: 100,
  MAX_QUERY_LIMIT: 1000,
  /** Batch size for bulk update operations */
  UPDATE_BATCH_SIZE: 100,
  /** Batch size for bulk delete operations */
  DELETE_BATCH_SIZE: 1000,
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
 * Byte budget for one page of row reads, or null when disabled (the default).
 * Dev-preview of the byte-bounded pagination follow-up: set `TABLE_MAX_PAGE_BYTES`
 * to cut pages early once their serialized row data exceeds the budget. The
 * production version moves the cut into SQL — see the pagination-hardening plan.
 */
export function getMaxPageBytes(): number | null {
  const value = envNumber(env.TABLE_MAX_PAGE_BYTES, 0, { min: 0, integer: true })
  return value > 0 ? value : null
}

/**
 * Maximum serialized size in bytes of a single row. Defaults to
 * `TABLE_LIMITS.MAX_ROW_SIZE_BYTES`; overridable via the
 * `TABLE_MAX_ROW_SIZE_BYTES` env var (server-only, read at call time).
 */
export function getMaxRowSizeBytes(): number {
  return envNumber(env.TABLE_MAX_ROW_SIZE_BYTES, TABLE_LIMITS.MAX_ROW_SIZE_BYTES, {
    min: 1,
    integer: true,
  })
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

export const COLUMN_TYPES = ['string', 'number', 'boolean', 'date', 'json'] as const

export const NAME_PATTERN = /^[a-z_][a-z0-9_]*$/i

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
