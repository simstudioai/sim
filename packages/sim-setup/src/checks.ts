import {
  ASYNC_JOBS_CAPABILITY,
  CACHE_CAPABILITY,
  CORE_CONFIGURATION_KEYS,
  EMAIL_CAPABILITY,
  EnvCapabilityConfigurationError,
  inspectCapability,
  inspectOAuthClientCapability,
  OAUTH_CLIENT_CAPABILITIES,
  OCR_CAPABILITY,
  requireCapability,
  SANDBOX_CAPABILITY,
  STORAGE_CAPABILITY,
} from '@sim/deployment-config/env-capabilities'
import { getSetupCommand } from './capability-config'
import { portOpen } from './detect'
import {
  type EnvFile,
  type EnvTarget,
  generateSecret,
  isPlaceholder,
  isTruthy,
  isUsableSecret,
  readEnvFile,
  SECRET_KEYS,
  SHARED_KEYS,
  secretRequirement,
  writeEnvValues,
} from './env-files'
import { httpHealth, pgProbe, redisPing } from './probes'
import { FLAG_TWINS, LOGIN_PROVIDERS } from './twins'

export type CheckGroup = 'files' | 'schema' | 'consistency' | 'coherence' | 'live'
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip'

export interface Finding {
  group: CheckGroup
  status: CheckStatus
  message: string
  fix?: string
  autofix?: () => void
}

/**
 * Which env-file topology this install uses. Compose mode writes a single root
 * `.env` (that's what `docker-compose.*.yml` reads via `env_file`), dev mode
 * writes the three per-app files. Checking for the wrong one reports a healthy
 * install as broken, so the layout is derived and every check consults it.
 */
export type EnvLayout = 'split' | 'root' | 'none'

export interface CheckContext {
  env: Record<EnvTarget, EnvFile>
  layout: EnvLayout
  /** The file holding app configuration for this layout — what coherence reads. */
  primary: EnvFile
  live: boolean
}

/** Split wins when both exist: the per-app files are what a dev run actually loads. */
function detectLayout(env: Record<EnvTarget, EnvFile>): EnvLayout {
  if (env.sim.exists || env.realtime.exists || env.db.exists) return 'split'
  return env.root.exists ? 'root' : 'none'
}

/** Targets whose files this layout expects to exist. */
function layoutTargets(layout: EnvLayout): EnvTarget[] {
  if (layout === 'split') return ['sim', 'realtime', 'db']
  return layout === 'root' ? ['root'] : []
}

export function loadCheckContext(live: boolean): CheckContext {
  const env = {
    sim: readEnvFile('sim'),
    realtime: readEnvFile('realtime'),
    db: readEnvFile('db'),
    root: readEnvFile('root'),
  }
  const layout = detectLayout(env)
  return { env, layout, primary: layout === 'root' ? env.root : env.sim, live }
}

export const REQUIRED_APP_KEYS = CORE_CONFIGURATION_KEYS

const REQUIRED_KEYS: Partial<Record<EnvTarget, readonly string[]>> = {
  sim: REQUIRED_APP_KEYS,
  realtime: [
    'DATABASE_URL',
    'BETTER_AUTH_URL',
    'BETTER_AUTH_SECRET',
    'INTERNAL_API_SECRET',
    'NEXT_PUBLIC_APP_URL',
  ],
  db: ['DATABASE_URL'],
  // Compose's single root .env only carries the secrets that have no safe
  // interpolation default in docker-compose.*.yml. DATABASE_URL, BETTER_AUTH_URL,
  // and NEXT_PUBLIC_APP_URL are supplied by `${VAR:-default}` there, so requiring
  // them here would fail a healthy compose install that never wrote them.
  root: ['BETTER_AUTH_SECRET', 'ENCRYPTION_KEY', 'INTERNAL_API_SECRET'],
}

const MIN_32_KEYS = new Set<string>(SECRET_KEYS)
const URL_KEYS = ['DATABASE_URL', 'BETTER_AUTH_URL', 'NEXT_PUBLIC_APP_URL']

function rel(file: EnvFile): string {
  return `${file.target === 'root' ? '' : file.target === 'db' ? 'packages/db/' : `apps/${file.target}/`}.env`
}

function checkFiles(ctx: CheckContext): Finding[] {
  if (ctx.layout === 'none') {
    return [
      {
        group: 'files',
        status: 'fail',
        message: 'no env files found',
        fix: 'run: npx sim-setup',
      },
    ]
  }
  const findings: Finding[] = []
  for (const target of layoutTargets(ctx.layout)) {
    const file = ctx.env[target]
    if (file.exists) {
      findings.push({
        group: 'files',
        status: 'pass',
        message: `${rel(file)} exists`,
      })
      continue
    }
    const canSeed = target !== 'sim' && ctx.env.sim.exists
    findings.push({
      group: 'files',
      status: 'fail',
      message: `${rel(file)} is missing`,
      fix: canSeed
        ? `run doctor --fix to seed it from apps/${target === 'db' ? '../packages/db' : target}/.env.example + apps/sim/.env`
        : 'run: npx sim-setup',
      autofix: canSeed
        ? () => {
            const keys = target === 'db' ? ['DATABASE_URL'] : [...SHARED_KEYS]
            const values: Record<string, string> = {}
            for (const key of keys) {
              const value = ctx.env.sim.vars.get(key)
              // Skip placeholders so seeding never copies an .env.example stub
              // into the new file (matches autofixForMissing).
              if (value && !isPlaceholder(value)) values[key] = value
            }
            writeEnvValues(target, values)
          }
        : undefined,
    })
  }
  return findings
}

function autofixForMissing(
  ctx: CheckContext,
  target: EnvTarget,
  key: string
): (() => void) | undefined {
  const simValue = ctx.env.sim.vars.get(key)
  if (
    target !== 'sim' &&
    (SHARED_KEYS as readonly string[]).includes(key) &&
    simValue &&
    !isPlaceholder(simValue)
  ) {
    return () => writeEnvValues(target, { [key]: simValue })
  }
  if (MIN_32_KEYS.has(key)) {
    return () => writeEnvValues(target, { [key]: generateSecret() })
  }
  return undefined
}

function checkSchema(ctx: CheckContext): Finding[] {
  const findings: Finding[] = []
  const production = process.env.NODE_ENV === 'production'
  for (const target of layoutTargets(ctx.layout)) {
    const file = ctx.env[target]
    if (!file.exists) continue
    const missing: string[] = []
    for (const key of REQUIRED_KEYS[target] ?? []) {
      const value = file.vars.get(key)
      if (!value) {
        missing.push(key)
        findings.push({
          group: 'schema',
          status: 'fail',
          message: `${rel(file)}: ${key} is missing or empty`,
          fix: MIN_32_KEYS.has(key) ? 'doctor --fix generates it' : `set ${key} in ${rel(file)}`,
          autofix: autofixForMissing(ctx, target, key),
        })
        continue
      }
      if (isPlaceholder(value)) {
        findings.push({
          group: 'schema',
          status: production ? 'fail' : 'warn',
          message: `${rel(file)}: ${key} still has the .env.example placeholder`,
          fix: MIN_32_KEYS.has(key)
            ? 'doctor --fix generates a real value'
            : `replace the placeholder in ${rel(file)}`,
          autofix: MIN_32_KEYS.has(key)
            ? () => writeEnvValues(target, { [key]: generateSecret() })
            : undefined,
        })
        continue
      }
      if (MIN_32_KEYS.has(key) && !isUsableSecret(key, value)) {
        findings.push({
          group: 'schema',
          status: 'fail',
          message: `${rel(file)}: ${key} ${secretRequirement(key)}`,
          fix: 'generate a new one with `openssl rand -hex 32` (rotating it invalidates existing sessions/encrypted data)',
        })
        continue
      }
      if (URL_KEYS.includes(key)) {
        try {
          new URL(value)
        } catch {
          findings.push({
            group: 'schema',
            status: 'fail',
            message: `${rel(file)}: ${key} is not a valid URL (${value})`,
            fix: `correct ${key} in ${rel(file)}`,
          })
        }
      }
    }
    if (missing.length === 0 && findings.every((f) => !f.message.startsWith(rel(file)))) {
      findings.push({
        group: 'schema',
        status: 'pass',
        message: `${rel(file)}: required keys valid`,
      })
    }
  }
  return findings
}

function checkConsistency(ctx: CheckContext): Finding[] {
  // Consistency is about the same key agreeing across files; a single root
  // file has nothing to disagree with.
  if (ctx.layout !== 'split') {
    return ctx.layout === 'root'
      ? [
          {
            group: 'consistency',
            status: 'skip',
            message: 'single .env — nothing to mirror',
          },
        ]
      : []
  }
  const findings: Finding[] = []
  const { sim, realtime, db } = ctx.env
  if (sim.exists && realtime.exists) {
    for (const key of SHARED_KEYS) {
      const simValue = sim.vars.get(key)
      const realtimeValue = realtime.vars.get(key)
      if (!simValue || !realtimeValue) continue
      if (simValue !== realtimeValue) {
        findings.push({
          group: 'consistency',
          status: 'fail',
          message: `${key} differs between apps/sim/.env and apps/realtime/.env`,
          fix: 'doctor --fix mirrors the apps/sim/.env value',
          autofix: () => writeEnvValues('realtime', { [key]: simValue }),
        })
      }
    }
  }
  if (sim.exists && db.exists) {
    const simDsn = sim.vars.get('DATABASE_URL')
    const dbDsn = db.vars.get('DATABASE_URL')
    if (simDsn && dbDsn && simDsn !== dbDsn) {
      findings.push({
        group: 'consistency',
        status: 'fail',
        message:
          'DATABASE_URL differs between apps/sim/.env and packages/db/.env — migrations would hit a different database',
        fix: 'doctor --fix mirrors the apps/sim/.env value',
        autofix: () => writeEnvValues('db', { DATABASE_URL: simDsn }),
      })
    }
  }
  if (findings.length === 0) {
    findings.push({
      group: 'consistency',
      status: 'pass',
      message: 'shared env subset is in sync across files',
    })
  }
  return findings
}

function checkCoherence(ctx: CheckContext): Finding[] {
  const findings: Finding[] = []
  const sim = ctx.primary
  if (!sim.exists) return findings
  const capabilityChecks = [
    {
      command: getSetupCommand(ASYNC_JOBS_CAPABILITY.id),
      resolve: () => requireCapability(ASYNC_JOBS_CAPABILITY, sim.vars),
    },
    {
      command: getSetupCommand(CACHE_CAPABILITY.id),
      resolve: () => requireCapability(CACHE_CAPABILITY, sim.vars),
    },
    {
      command: getSetupCommand(SANDBOX_CAPABILITY.id),
      resolve: () => {
        const inspection = inspectCapability(SANDBOX_CAPABILITY, sim.vars)
        if (inspection.error) throw inspection.error
        return inspection
      },
    },
    {
      command: getSetupCommand(OCR_CAPABILITY.id),
      resolve: () => requireCapability(OCR_CAPABILITY, sim.vars),
    },
  ]
  for (const check of capabilityChecks) {
    try {
      check.resolve()
    } catch (error) {
      if (!(error instanceof EnvCapabilityConfigurationError)) throw error
      findings.push({
        group: 'coherence',
        status: 'fail',
        message: error.message,
        fix: check.command,
      })
    }
  }
  const appUrl = sim.vars.get('NEXT_PUBLIC_APP_URL')
  if (appUrl) {
    try {
      const host = new URL(appUrl).hostname
      if (host === 'sim.ai' || host.endsWith('.sim.ai')) {
        findings.push({
          group: 'coherence',
          status: 'warn',
          message: `NEXT_PUBLIC_APP_URL points at ${host} — this flips isHosted=true and disables self-host overrides`,
          fix: 'use your own domain or http://localhost:3000',
        })
      }
    } catch {
      // schema group already reports the invalid URL
    }
  }
  try {
    requireCapability(STORAGE_CAPABILITY, sim.vars)
  } catch (error) {
    if (!(error instanceof EnvCapabilityConfigurationError)) throw error
    findings.push({
      group: 'coherence',
      status: 'fail',
      message: error.message,
      fix: getSetupCommand(STORAGE_CAPABILITY.id),
    })
  }
  for (const { server, client } of FLAG_TWINS) {
    const serverValue = sim.vars.get(server)
    const clientValue = sim.vars.get(client)
    const bothUnset = serverValue === undefined && clientValue === undefined
    if (bothUnset || isTruthy(serverValue) === isTruthy(clientValue)) continue
    const setSide = serverValue !== undefined ? server : client
    const missingSide = serverValue !== undefined ? client : server
    const value = serverValue ?? clientValue ?? ''
    findings.push({
      group: 'coherence',
      status: 'fail',
      message: `${setSide} is set but its twin ${missingSide} disagrees — server and browser will render different features`,
      fix: `doctor --fix sets ${missingSide}=${value}`,
      // Write to the layout's primary env (root on a compose install), not always sim.
      autofix: () => writeEnvValues(sim.target, { [missingSide]: value }),
    })
  }

  /**
   * Function sandbox visibility is not a 1:1 server/client twin. The selected
   * provider is ready only when its credential and immutable Function base are
   * valid, while the browser separately reads the public visibility flag.
   */
  const sandboxInspection = inspectCapability(SANDBOX_CAPABILITY, sim.vars)
  const sandboxProvider = sandboxInspection.providerId
  const selectedSandboxProvider = sandboxInspection.providers.find(
    (provider) => provider.id === sandboxProvider
  )
  const remoteSandboxAvailable =
    !sandboxInspection.error && selectedSandboxProvider?.state === 'ready'
  const publicSandboxEnabled = isTruthy(sim.vars.get('NEXT_PUBLIC_SANDBOXES_ENABLED'))
  if (remoteSandboxAvailable && !publicSandboxEnabled) {
    findings.push({
      group: 'coherence',
      status: 'fail',
      message:
        'remote sandboxes are configured but NEXT_PUBLIC_SANDBOXES_ENABLED is unset — the Function block will hide its language and sandbox controls',
      fix: 'doctor --fix sets NEXT_PUBLIC_SANDBOXES_ENABLED=true',
      autofix: () => writeEnvValues(sim.target, { NEXT_PUBLIC_SANDBOXES_ENABLED: 'true' }),
    })
  } else if (!remoteSandboxAvailable && publicSandboxEnabled) {
    findings.push({
      group: 'coherence',
      status: 'fail',
      message:
        'NEXT_PUBLIC_SANDBOXES_ENABLED is on but the selected provider lacks credentials or a valid immutable Function base — the UI exposes a runtime that will reject execution',
      fix: 'doctor --fix sets NEXT_PUBLIC_SANDBOXES_ENABLED=false; finish provider setup before enabling it',
      autofix: () => writeEnvValues(sim.target, { NEXT_PUBLIC_SANDBOXES_ENABLED: 'false' }),
    })
  }

  const disableAuth = sim.vars.get('DISABLE_AUTH')
  if (
    isTruthy(disableAuth) &&
    ctx.env.realtime.exists &&
    !isTruthy(ctx.env.realtime.vars.get('DISABLE_AUTH'))
  ) {
    findings.push({
      group: 'coherence',
      status: 'fail',
      message:
        'DISABLE_AUTH is on in apps/sim/.env but not apps/realtime/.env — the socket server still enforces auth, so the canvas breaks silently',
      fix: 'doctor --fix mirrors it into apps/realtime/.env',
      autofix: () => writeEnvValues('realtime', { DISABLE_AUTH: disableAuth as string }),
    })
  }

  const email = inspectCapability(EMAIL_CAPABILITY, sim.vars)
  const emailConfigured = email.configured
  if (email.error) {
    findings.push({
      group: 'coherence',
      status: 'fail',
      message: email.error.message,
      fix: getSetupCommand(EMAIL_CAPABILITY.id),
    })
  }
  if (isTruthy(sim.vars.get('EMAIL_VERIFICATION_ENABLED')) && !emailConfigured) {
    findings.push({
      group: 'coherence',
      status: 'fail',
      message:
        'EMAIL_VERIFICATION_ENABLED is on but no mail provider is configured — the app must bypass verification to avoid locking out new users',
      fix: `${getSetupCommand(EMAIL_CAPABILITY.id)}, or turn verification off`,
    })
  }

  for (const providerId of Object.keys(OAUTH_CLIENT_CAPABILITIES)) {
    const oauth = inspectOAuthClientCapability(providerId, sim.vars)
    if (oauth.state !== 'partial' && oauth.state !== 'invalid') continue
    findings.push({
      group: 'coherence',
      status: 'fail',
      message: `${providerId} OAuth is partially configured — missing ${oauth.missingFields.join(', ')}`,
      fix: oauth.setupCommand,
    })
  }

  const featureRules: Array<{
    flag: string
    needs: string[]
    label: string
    disableFields?: string[]
  }> = [
    {
      flag: 'BILLING_ENABLED',
      needs: ['STRIPE_SECRET_KEY'],
      label: 'billing',
    },
    {
      flag: 'SLACK_EXTENDED_SCOPES',
      needs: ['SLACK_SIGNING_SECRET'],
      label: 'native Slack triggers',
      disableFields: ['SLACK_EXTENDED_SCOPES', 'NEXT_PUBLIC_SLACK_EXTENDED_SCOPES'],
    },
    { flag: 'SSO_ENABLED', needs: ['SSO_ISSUER'], label: 'SSO' },
  ]
  for (const rule of featureRules) {
    if (!isTruthy(sim.vars.get(rule.flag))) continue
    const missing = rule.needs.filter((key) => !sim.vars.get(key)?.trim())
    if (missing.length > 0) {
      findings.push({
        group: 'coherence',
        status: 'fail',
        message: `${rule.flag} is on but ${missing.join(', ')} is not set — ${rule.label} will fail at runtime`,
        fix: `set ${missing.join(', ')} or remove ${(rule.disableFields ?? [rule.flag]).join(' and ')}`,
      })
    }
  }
  if (
    Boolean(sim.vars.get('TURNSTILE_SECRET_KEY')) !==
    Boolean(sim.vars.get('NEXT_PUBLIC_TURNSTILE_SITE_KEY'))
  ) {
    findings.push({
      group: 'coherence',
      status: 'fail',
      message:
        'Turnstile is half-configured — TURNSTILE_SECRET_KEY and NEXT_PUBLIC_TURNSTILE_SITE_KEY must both be set',
      fix: 'set the missing Turnstile var or remove both',
    })
  }
  for (const provider of LOGIN_PROVIDERS) {
    if (Boolean(sim.vars.get(provider.idKey)) !== Boolean(sim.vars.get(provider.secretKey))) {
      findings.push({
        group: 'coherence',
        status: 'fail',
        message: `${provider.label} login is half-configured — ${provider.idKey} and ${provider.secretKey} must both be set`,
        fix: 'set the missing credential or remove both',
      })
    }
  }

  const appUrlValue = sim.vars.get('NEXT_PUBLIC_APP_URL')
  if (
    appUrlValue &&
    !appUrlValue.includes('localhost') &&
    !appUrlValue.includes('127.0.0.1') &&
    !sim.vars.get('NEXT_PUBLIC_SOCKET_URL')
  ) {
    findings.push({
      group: 'coherence',
      status: 'warn',
      message:
        'NEXT_PUBLIC_APP_URL is not localhost but NEXT_PUBLIC_SOCKET_URL is unset — the browser cannot find the realtime server',
      fix: 'set NEXT_PUBLIC_SOCKET_URL to the public URL of the realtime service (:3002)',
    })
  }

  if (findings.length === 0) {
    findings.push({
      group: 'coherence',
      status: 'pass',
      message: 'no conflicting settings',
    })
  }
  return findings
}

async function checkDatabase(sim: EnvFile): Promise<Finding[]> {
  const findings: Finding[] = []
  const dsn = sim.vars.get('DATABASE_URL')
  const dsnPassword = (() => {
    try {
      return dsn ? new URL(dsn).password : null
    } catch {
      return null
    }
  })()
  if (dsn && dsnPassword !== null && !isPlaceholder(dsnPassword)) {
    const probe = await pgProbe(dsn)
    if (!probe.ok) {
      findings.push({
        group: 'live',
        status: 'fail',
        message: `database unreachable: ${probe.error}`,
        fix: 'start Postgres (npx sim-setup can manage a pgvector container) or fix DATABASE_URL',
      })
    } else {
      findings.push({
        group: 'live',
        status: 'pass',
        message: 'database reachable',
      })
      if (!probe.pgvectorAvailable) {
        findings.push({
          group: 'live',
          status: 'fail',
          message: 'pgvector extension is not available on this Postgres',
          fix: 'use the pgvector/pgvector:pg17 image or install the extension',
        })
      }
      const { applied, journal } = probe.migrations ?? {
        applied: null,
        journal: null,
      }
      if (applied === null) {
        findings.push({
          group: 'live',
          status: 'fail',
          message: 'migrations have never run on this database',
          fix: 'cd packages/db && bun run db:migrate',
        })
      } else if (journal !== null && applied < journal) {
        findings.push({
          group: 'live',
          status: 'warn',
          message: `database has ${applied}/${journal} migrations applied`,
          fix: 'cd packages/db && bun run db:migrate',
        })
      } else {
        findings.push({
          group: 'live',
          status: 'pass',
          message:
            journal === null
              ? `database has ${applied} migrations applied`
              : `migrations up to date (${applied})`,
        })
      }
    }
  } else {
    findings.push({
      group: 'live',
      status: 'skip',
      message: 'database: DATABASE_URL not usable yet',
    })
  }

  return findings
}

async function checkRedis(sim: EnvFile): Promise<Finding[]> {
  const inspection = inspectCapability(CACHE_CAPABILITY, sim.vars)
  if (inspection.error || inspection.providerId !== 'redis') return []
  const redisUrl = sim.vars.get('REDIS_URL')
  if (!redisUrl) throw new Error('Redis resolved as ready without REDIS_URL')
  const ping = await redisPing(redisUrl)
  return [
    ping.ok
      ? { group: 'live', status: 'pass', message: 'redis reachable' }
      : {
          group: 'live',
          status: 'fail',
          message: `redis unreachable: ${ping.error}`,
          fix: 'fix REDIS_URL or remove it (optional for single-replica)',
        },
  ]
}

async function checkService(label: string, port: number, url: string): Promise<Finding[]> {
  if (!(await portOpen(port))) {
    return [
      {
        group: 'live',
        status: 'skip',
        message: `${label}: not running on :${port}`,
      },
    ]
  }
  if (await httpHealth(url)) {
    return [
      {
        group: 'live',
        status: 'pass',
        message: `${label} healthy on :${port}`,
      },
    ]
  }
  return [
    {
      group: 'live',
      status: 'fail',
      message: `${label}: something is on :${port} but ${url} is not answering`,
      fix: 'check the dev server logs',
    },
  ]
}

async function checkOllama(sim: EnvFile): Promise<Finding[]> {
  const ollamaUrl = sim.vars.get('OLLAMA_URL')
  if (!ollamaUrl) return []
  return [
    (await httpHealth(`${ollamaUrl.replace(/\/$/, '')}/api/tags`))
      ? { group: 'live', status: 'pass', message: 'ollama reachable' }
      : {
          group: 'live',
          status: 'warn',
          message: 'OLLAMA_URL is set but Ollama is not answering',
          fix: 'start Ollama or remove OLLAMA_URL',
        },
  ]
}

/**
 * The five probes are independent, so they run concurrently — serially this is
 * the sum of every timeout (~17s worst case) on a command whose whole job is to
 * tell you what's broken. Results are concatenated in a fixed order so the
 * report stays deterministic regardless of which probe settles first.
 */
async function checkLive(ctx: CheckContext): Promise<Finding[]> {
  const sim = ctx.primary
  const [database, redis, app, realtime, ollama] = await Promise.all([
    checkDatabase(sim),
    checkRedis(sim),
    checkService('app', 3000, 'http://localhost:3000/api/health'),
    checkService('realtime', 3002, 'http://localhost:3002/health'),
    checkOllama(sim),
  ])
  return [...database, ...redis, ...app, ...realtime, ...ollama]
}

export async function runChecks(ctx: CheckContext, groups?: CheckGroup[]): Promise<Finding[]> {
  const findings: Finding[] = [
    ...checkFiles(ctx),
    ...checkSchema(ctx),
    ...checkConsistency(ctx),
    ...checkCoherence(ctx),
  ]
  if (ctx.live) findings.push(...(await checkLive(ctx)))
  return groups ? findings.filter((f) => groups.includes(f.group)) : findings
}
