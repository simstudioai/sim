/**
 * Limits and constants for user-defined tables.
 */

export const TABLE_LIMITS = {
  MAX_TABLES_PER_WORKSPACE: 100,
  MAX_ROWS_PER_TABLE: 10000,
  MAX_ROW_SIZE_BYTES: 100 * 1024, // 100KB
  MAX_COLUMNS_PER_TABLE: 50,
  MAX_TABLE_NAME_LENGTH: 50,
  MAX_COLUMN_NAME_LENGTH: 50,
  MAX_STRING_VALUE_LENGTH: 10000,
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
} as const

/**
 * Plan-based table limits.
 */
export const TABLE_PLAN_LIMITS = {
  free: {
    maxTables: 3,
    maxRowsPerTable: 1000,
  },
  pro: {
    maxTables: 25,
    maxRowsPerTable: 5000,
  },
  team: {
    maxTables: 100,
    maxRowsPerTable: 10000,
  },
  enterprise: {
    maxTables: 10000,
    maxRowsPerTable: 1000000,
  },
} as const

export type PlanName = keyof typeof TABLE_PLAN_LIMITS

export interface TablePlanLimits {
  maxTables: number
  maxRowsPerTable: number
}

export const COLUMN_TYPES = ['string', 'number', 'boolean', 'date', 'json'] as const

export const NAME_PATTERN = /^[a-z_][a-z0-9_]*$/i

export const USER_TABLE_ROWS_SQL_NAME = 'user_table_rows'

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
    const adj = TABLE_NAME_ADJECTIVES[Math.floor(Math.random() * TABLE_NAME_ADJECTIVES.length)]
    const noun = TABLE_NAME_NOUNS[Math.floor(Math.random() * TABLE_NAME_NOUNS.length)]
    const name = `${adj.toLowerCase()}_${noun.toLowerCase()}`
    if (!taken.has(name)) return name
  }

  const adj = TABLE_NAME_ADJECTIVES[Math.floor(Math.random() * TABLE_NAME_ADJECTIVES.length)]
  const noun = TABLE_NAME_NOUNS[Math.floor(Math.random() * TABLE_NAME_NOUNS.length)]
  const suffix = Math.floor(Math.random() * 900) + 100
  return `${adj.toLowerCase()}_${noun.toLowerCase()}_${suffix}`
}
