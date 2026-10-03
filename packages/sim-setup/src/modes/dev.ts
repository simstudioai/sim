import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { truncate } from '@sim/utils/string'
import { EMAIL_SETUP, JOBS_SETUP, STORAGE_SETUP } from '../capability-config'
import { promptCapabilitySetup, stageCapabilitySetupTransition } from '../capability-setup'
import { resolveDatabase } from '../db'
import type { Detection } from '../detect'
import { ROOT, readEnvFile, reconcileEnvValues, writeEnvValues } from '../env-files'
import { SetupError } from '../errors'
import { pgProbe } from '../probes'
import * as p from '../prompter'
import { ensureRedis, resolveRedis } from '../redis'
import {
  chatFlagValues,
  collectSecrets,
  mothershipOverride,
  promptCopilotKey,
  promptKnowledgeEmbeddings,
  promptLlmKeys,
  promptSecurity,
  promptSignInProviders,
  promptUnlocks,
} from '../steps'
import { glyph, theme } from '../theme'
import { APP_URL } from '../urls'

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
      'Configure Redis? (powers live Chat status and table events; storage falls back to Postgres)',
    initialValue: true,
  })
  if (!wants) return null
  return resolveRedis(detection, existing)
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
  const remove = new Set<string>()
  // Before the key is minted: a half-set override mints against one environment
  // and validates against the other, and warning afterwards is too late — the
  // bad key is already stored, and the next run offers to keep it.
  Object.assign(values, mothershipOverride())
  const copilotKey = await promptCopilotKey(simAfter.vars.get('COPILOT_API_KEY'))
  if (copilotKey) values.COPILOT_API_KEY = copilotKey
  Object.assign(values, chatFlagValues(copilotKey))
  Object.assign(values, await promptLlmKeys(detection, !quick))

  // Redis is set up in every mode, quick included. Storage falls back to
  // PostgreSQL without it, but the pub/sub channels (live Chat task-status,
  // table events) have no fallback — skipping it silently produces an install
  // where live updates never arrive. Quick configures it with no questions at
  // all; custom keeps the opt-out and the where-should-it-live ladder.
  const redisUrl = quick
    ? await ensureRedis(detection, simAfter.vars.get('REDIS_URL'))
    : await promptRedis(detection, simAfter.vars.get('REDIS_URL'))
  if (redisUrl) {
    values.REDIS_URL = redisUrl
    writeEnvValues('realtime', { REDIS_URL: redisUrl })
  }

  const stagedVars = new Map(simAfter.vars)
  for (const [key, value] of Object.entries(values)) stagedVars.set(key, value)
  const embeddings = await promptKnowledgeEmbeddings(stagedVars, { containerized: false })
  if (embeddings) {
    stageCapabilitySetupTransition(stagedVars, values, remove, embeddings)
  }

  if (!quick) {
    for (const setup of [JOBS_SETUP, STORAGE_SETUP, EMAIL_SETUP] as const) {
      const transition = await promptCapabilitySetup(setup, stagedVars, {
        containerized: false,
      })
      stageCapabilitySetupTransition(stagedVars, values, remove, transition)
    }
    Object.assign(values, await promptSignInProviders(stagedVars, APP_URL))
    const security = await promptSecurity(simAfter.vars)
    Object.assign(values, security.sim)
    if (Object.keys(security.mirrorToRealtime).length > 0) {
      writeEnvValues('realtime', security.mirrorToRealtime)
    }
    Object.assign(values, await promptUnlocks(simAfter.vars))
  }
  for (const key of Object.keys(values)) remove.delete(key)
  if (remove.size > 0 || Object.keys(values).length > 0) {
    reconcileEnvValues('sim', [...remove], values)
  }

  let script = 'dev:full'
  if (detection.specs.hostMemGb < 16) {
    script = await p.select({
      message: `Low RAM detected (${detection.specs.hostMemGb}GB) — which dev server?`,
      options: [
        {
          value: 'dev:full:capped',
          label: 'Capped heap (recommended)',
          hint: 'caps Node at 4GB — every integration still available',
        },
        {
          value: 'dev:full',
          label: 'Uncapped',
          hint: 'lets the dev server take what it needs (~4GB typical)',
        },
      ],
      initialValue: 'dev:full:capped',
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
