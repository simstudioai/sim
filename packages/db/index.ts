import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export * from './schema'

const connectionString = process.env.DATABASE_URL!
if (!connectionString) {
  throw new Error('Missing DATABASE_URL environment variable')
}

export const DB_DEFAULT_SCHEMA = process.env.DB_DEFAULT_SCHEMA || 'SQLUser'
export const DB_METADATA_SCHEMA = process.env.DB_METADATA_SCHEMA || 'drizzle'

const poolMax = Number.parseInt(process.env.DATABASE_POOL_MAX ?? '30', 10)

const postgresClient = postgres(connectionString, {
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 30,
  max: Number.isNaN(poolMax) ? 30 : poolMax,
  onnotice: () => {},
  debug: (connection: any, query: string, params: any) => {
    if (process.env.DB_TYPE === 'iris') {
      console.log('IRIS SQL:', query)
      console.log('IRIS Params:', params)
    }
  },
  ...(process.env.DB_TYPE === 'iris'
    ? ({
        fetch_types: false, // Skip pg_type introspection query for IRIS compatibility
        parameters: {
          search_path: `${DB_DEFAULT_SCHEMA}, ${DB_METADATA_SCHEMA}, public`,
        },
        transform: {
          row: (row: any) => {
            if (!row) return row

            const normalized: Record<string, any> = {}
            const columns = (row as any).columns

            if (columns) {
              columns.forEach((col: any, idx: number) => {
                const name = (col.name || '').toLowerCase()
                if (name) {
                  normalized[name] = row[idx]
                }
              })
            } else if (typeof row === 'object' && !Array.isArray(row)) {
              for (const [key, value] of Object.entries(row)) {
                normalized[key.toLowerCase()] = value
              }
            } else {
              return row
            }

            const finalRow: Record<string, any> = {}
            for (const key in normalized) {
              const val = normalized[key]
              let finalVal = val

              if (typeof val === 'bigint') {
                const valStr = val.toString()
                if (valStr.length >= 18) {
                  try {
                    if (
                      key.toLowerCase().includes('created') ||
                      key.toLowerCase().includes('updated')
                    ) {
                      finalVal = new Date().toISOString()
                    }
                  } catch (e) {}
                }
              }

              if (typeof val === 'string' && val.startsWith('$lb(')) {
                finalVal = '[IRIS Stream]'
              }

              finalRow[key] = finalVal
              const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase())
              if (camelKey !== key) {
                finalRow[camelKey] = finalVal
              }
            }

            return finalRow
          },
        },
      } as any)
    : {}),
})

export const dbClient = postgresClient
export const db = drizzle(postgresClient, { schema })
