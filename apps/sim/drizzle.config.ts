import fs from 'fs'
import os from 'os'
import path from 'path'
import type { Config } from 'drizzle-kit'
import { env } from './lib/env'

const connectionString = env.POSTGRES_URL ?? env.DATABASE_URL

let sslConfig: { rejectUnauthorized: boolean; ca: string } | undefined
if (env.DATABASE_SSL_CERT) {
  const tmpDir = process.env.TMPDIR || os.tmpdir()
  const tmpPath = path.join(tmpDir, `sim-db-ca-${process.pid}.crt`)
  try {
    fs.writeFileSync(tmpPath, env.DATABASE_SSL_CERT, { encoding: 'utf-8', mode: 0o600 })
    sslConfig = { rejectUnauthorized: true, ca: tmpPath }

    const cleanup = () => {
      try {
        fs.rmSync(tmpPath)
      } catch {}
    }

    process.once('exit', cleanup)
    process.once('SIGINT', cleanup)
    process.once('SIGTERM', cleanup)
  } catch {
    // If writing fails, leave sslConfig undefined and allow connection to fail fast
  }
}

export default {
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: connectionString,
    ssl: sslConfig,
  },
} satisfies Config
