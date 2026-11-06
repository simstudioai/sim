import { parseArgs } from 'node:util'
import { sealAccountTokens } from '@sim/db/script-migrations/0037_seal_account_tokens'
import { createLogger } from '@sim/logger'
import postgres from 'postgres'

const logger = createLogger('AccountTokenSealing', { enabled: true, logLevel: 'INFO' })
const REQUIRED_ACK = 'sealed-readers-deployed'

const { values } = parseArgs({
  options: {
    unseal: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    'expect-key-id': { type: 'string' },
  },
})

const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
if (!url) throw new Error('Missing MIGRATION_DATABASE_URL or DATABASE_URL')
if (
  !values['dry-run'] &&
  !values.unseal &&
  process.env.ACCOUNT_TOKEN_SEALING_ACK !== REQUIRED_ACK
) {
  throw new Error(
    `Set ACCOUNT_TOKEN_SEALING_ACK=${REQUIRED_ACK} only once every app, worker, and background ` +
      'task deployment runs a release that reads sealed account tokens'
  )
}

if (!values['dry-run'] && !values['expect-key-id']) {
  throw new Error(
    'Pass --expect-key-id with the key id the fleet logs at startup (a dry run prints this key id)'
  )
}

/** The pass reads and writes the unqualified `account` table, so a URL-supplied path cannot redirect it. */
const databaseUrl = new URL(url)
databaseUrl.searchParams.set('search_path', 'public, pg_temp')

const sql = postgres(databaseUrl.toString(), {
  max: 1,
  prepare: false,
  connect_timeout: 10,
  max_lifetime: null,
  connection: { application_name: 'sim-account-token-sealing' },
})

try {
  const result = await sealAccountTokens(sql, {
    mode: values.unseal ? 'unseal' : 'seal',
    expectedKeyId: values['expect-key-id'],
    dryRun: values['dry-run'],
  })
  logger.info('Account token sealing finished', result)
} finally {
  await sql.end()
}
