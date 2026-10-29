import postgres from 'postgres'

let client: ReturnType<typeof postgres> | undefined

/** The public docs service has its own bounded pool, independent of platform request traffic. */
export function searchDatabase() {
  if (client) return client
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required for the optional hybrid search index')
  client = postgres(url, {
    max: 2,
    connect_timeout: 2,
    idle_timeout: 20,
    prepare: false,
    connection: { application_name: 'sim-docs-search', statement_timeout: 2000 },
  })
  return client
}
