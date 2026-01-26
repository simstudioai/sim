import type { Config } from 'drizzle-kit'

export default {
  schema: './schema.ts',
  out: process.env.DB_TYPE === 'iris' ? './migrations_iris' : './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  ...(process.env.DB_TYPE === 'iris'
    ? {
        migrations: {
          schema: process.env.DB_METADATA_SCHEMA || 'drizzle',
        },
      }
    : {}),
} satisfies Config
