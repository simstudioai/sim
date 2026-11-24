import { createTableCodec, type TableColumnCatalog } from './table'

/**
 * The column catalog the package tests read tables with: the one apps/sim builds from its
 * column-type registry, which an apps/sim test holds this copy equal to.
 */
export const TEST_TABLE_COLUMNS: TableColumnCatalog = {
  types: {
    string: { owns: [], unique: true },
    number: { owns: [], unique: true },
    currency: { owns: ['currencyCode'], unique: true, defaults: { currencyCode: 'USD' } },
    boolean: { owns: [], unique: true },
    date: { owns: [], unique: true },
    ttl: { owns: [], unique: true, maxPerTable: 1 },
    json: { owns: [], unique: true },
    select: { owns: ['options', 'multiple'], unique: false },
  },
  maxOptions: 100,
}

/** The table codec over {@link TEST_TABLE_COLUMNS}. */
export const testTableCodec = createTableCodec(TEST_TABLE_COLUMNS)
