import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { truncate } from '@sim/utils/string'
import { resolveDatabase } from '../db.ts'
import type { Detection } from '../detect.ts'
import { ROOT, readEnvFile, writeEnvValues } from '../env-files.ts'
import { SetupError } from '../errors.ts'
import { pgProbe } from '../probes.ts'
import * as p from '../prompter.ts'
import { resolveRedis } from '../redis.ts'
import {
  collectSecrets,
  promptCopilotKey,
  promptEmail,
  promptLlmKeys,
  promptSecurity,
  promptSignInProviders,
  promptStorage,
  promptUnlocks,
} from '../steps.ts'
import { glyph, theme } from '../theme.ts'

const APP_URL = 'http://localhost:3000'

/**
 * A migrate failure on a never-migrated database means setup failed — abort.
 * On a database that already has applied migrations (a live but drifted dev
 * DB), the failure is surfaced and the user decides whether to continue.
 */
async function runMigrations(dsn: string): Promise<void> {
  const spin = p.spinner()
  spin.start('Running database migrations…')
  const result = spawnSync('bun', ['run', 'db:migrate'], {
    cwd: path.join(ROOT, 'packages/db'),
    encoding: 'utf8',
  })
  if (result.status === 0) {
    spin.stop('Migrations applied')
    return
  }
  spin.stop(`${glyph.fail} migrations failed`)
  const error = truncate(`${result.stdout}\n${result.stderr}`.trim(), 2000)
  const probe = await pgProbe(dsn)
  const applied = probe.ok ? (probe.migrations?.applied ?? 0) : 0
  if (applied === 0) {
    throw new SetupError(`db:migrate failed on a fresh database:\n${error}`, [
      `run it by hand to see the full output: ${theme.command('cd packages/db && bun run db:migrate')}`,
      'check DATABASE_URL points at the database you expect',
    ])
  }
  p.log.warn(
    `db:migrate failed, but this database already has ${applied} applied migrations — it may have schema drift (e.g. built with db:push).`
  )
  p.log.info(theme.muted(truncate(error, 600)))
  const proceed = await p.confirm({
    message: 'Continue setup without migrating? (doctor will keep flagging the drift)',
    initialValue: true,
  })
  if (!proceed) throw new Error(`aborted: db:migrate failed:\n${error}`)
}

async function promptRedis(detection: Detection, existing?: string): Promise<string | null> {
  const wants = await p.confirm({
    message:
      'Configure Redis? (only needed for multi-replica — single instance runs fine without it)',
    initialValue: Boolean(existing),
  })
  if (!wants) return null
  return resolveRedis(detection, existing)
}

async function promptTrigger(): Promise<Record<string, string> | null> {
  const wants = await p.confirm({
    message: 'Enable Trigger.dev for background jobs? (off = jobs run via the DB queue)',
    initialValue: false,
  })
  if (!wants) return null
  const secretKey = await p.password({
    message: 'TRIGGER_SECRET_KEY',
    validate: (v) => (v ? undefined : 'required'),
  })
  const projectId = await p.text({
    message: 'TRIGGER_PROJECT_ID',
    validate: (v) => (v ? undefined : 'required'),
  })
  return {
    TRIGGER_DEV_ENABLED: 'true',
    TRIGGER_SECRET_KEY: secretKey,
    TRIGGER_PROJECT_ID: projectId,
  }
}

export async function runDevMode(
  detection: Detection,
  quick: boolean
): Promise<{ startNow: boolean; script: string }> {
  const sim = readEnvFile('sim')
  const dsn = await resolveDatabase(detection, sim.vars.get('DATABASE_URL'))
  const secrets = collectSecrets(sim)

  const shared = {
    DATABASE_URL: dsn,
    BETTER_AUTH_SECRET: secrets.BETTER_AUTH_SECRET,
    INTERNAL_API_SECRET: secrets.INTERNAL_API_SECRET,
    BETTER_AUTH_URL: APP_URL,
    NEXT_PUBLIC_APP_URL: APP_URL,
  }
  writeEnvValues('sim', {
    ...shared,
    ENCRYPTION_KEY: secrets.ENCRYPTION_KEY,
    API_ENCRYPTION_KEY: secrets.API_ENCRYPTION_KEY,
  })
  writeEnvValues('realtime', shared)
  writeEnvValues('db', { DATABASE_URL: dsn })
  p.log.step('Wrote apps/sim/.env, apps/realtime/.env, packages/db/.env (shared subset mirrored)')
  await runMigrations(dsn)

  const simAfter = readEnvFile('sim')
  const values: Record<string, string> = {}
  const copilotKey = await promptCopilotKey(simAfter.vars.get('COPILOT_API_KEY'))
  if (copilotKey) values.COPILOT_API_KEY = copilotKey
  Object.assign(values, await promptLlmKeys(detection, !quick))

  if (!quick) {
    const redisUrl = await promptRedis(detection, simAfter.vars.get('REDIS_URL'))
    if (redisUrl) {
      values.REDIS_URL = redisUrl
      writeEnvValues('realtime', { REDIS_URL: redisUrl })
    }
    const trigger = await promptTrigger()
    if (trigger) Object.assign(values, trigger)
    const storage = await promptStorage(simAfter.vars, false)
    if (storage) Object.assign(values, storage)
    Object.assign(values, await promptSignInProviders(simAfter.vars, APP_URL))
    Object.assign(values, await promptEmail(simAfter.vars))
    const security = await promptSecurity(simAfter.vars)
    Object.assign(values, security.sim)
    if (Object.keys(security.mirrorToRealtime).length > 0) {
      writeEnvValues('realtime', security.mirrorToRealtime)
    }
    Object.assign(values, await promptUnlocks(simAfter.vars))
  }
  if (Object.keys(values).length > 0) writeEnvValues('sim', values)

  let script = 'dev:full'
  if (detection.specs.hostMemGb < 16) {
    script = await p.select({
      message: `Low RAM detected (${detection.specs.hostMemGb}GB) — which dev server?`,
      options: [
        {
          value: 'dev:full:minimal-registry',
          label: 'Minimal block registry (recommended)',
          hint: 'much lower memory — loads fewer integration blocks in dev',
        },
        {
          value: 'dev:full',
          label: 'Full registry',
          hint: 'every block available — can use 4-5GB+ on its own',
        },
      ],
      initialValue: 'dev:full:minimal-registry',
    })
  }
  return {
    startNow: await p.confirm({
      message: `Start Sim now? (bun run ${script})`,
      initialValue: true,
    }),
    script,
  }
}
