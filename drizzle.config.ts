import type { Config } from 'drizzle-kit'

export default {
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: 'postgresql://postgres:%23WaldoEmmy1@db.jchdgebatsqopodtyast.supabase.co:5432/postgres',
  },
} satisfies Config
