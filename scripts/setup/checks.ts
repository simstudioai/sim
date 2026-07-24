import { portOpen } from './detect.ts'
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
} from './env-files.ts'
import { httpHealth, pgProbe, redisPing } from './probes.ts'
import { FLAG_TWINS, hasMailProvider, LOGIN_PROVIDERS } from './twins.ts'

export type CheckGroup = 'files' | 'schema' | 'consistency' | 'coherence' | 'live'
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip'

export interface Finding {
  group: CheckGroup
  status: CheckStatus
  message: string
  fix?: string
  autofix?: () => void
}

export interface CheckContext {
  env: Record<EnvTarget, EnvFile>
  live: boolean
}

export function loadCheckContext(live: boolean): CheckContext {
  return {
    env: {
      sim: readEnvFile('sim'),
      realtime: readEnvFile('realtime'),
      db: readEnvFile('db'),
      root: readEnvFile('root'),
    },
    live,
  }
}

const REQUIRED_KEYS: Partial<Record<EnvTarget, string[]>> = {
  sim: [
    'DATABASE_URL',
    'BETTER_AUTH_SECRET',
    'BETTER_AUTH_URL',
    'NEXT_PUBLIC_APP_URL',
    'ENCRYPTION_KEY',
    'INTERNAL_API_SECRET',
  ],
  realtime: [
    'DATABASE_URL',
    'BETTER_AUTH_URL',
    'BETTER_AUTH_SECRET',
    'INTERNAL_API_SECRET',
    'NEXT_PUBLIC_APP_URL',
  ],
  db: ['DATABASE_URL'],
}

const MIN_32_KEYS = new Set<string>(SECRET_KEYS)
const URL_KEYS = ['DATABASE_URL', 'BETTER_AUTH_URL', 'NEXT_PUBLIC_APP_URL']

function rel(file: EnvFile): string {
  return `${file.target === 'root' ? '' : file.target === 'db' ? 'packages/db/' : `apps/${file.target}/`}.env`
}

function checkFiles(ctx: CheckContext): Finding[] {
  const findings: Finding[] = []
  for (const target of ['sim', 'realtime', 'db'] as const) {
    const file = ctx.env[target]
    if (file.exists) {
      findings.push({ group: 'files', status: 'pass', message: `${rel(file)} exists` })
      continue
    }
    const canSeed = target !== 'sim' && ctx.env.sim.exists
    findings.push({
      group: 'files',
      status: 'fail',
      message: `${rel(file)} is missing`,
      fix: canSeed
        ? `run doctor --fix to seed it from apps/${target === 'db' ? '../packages/db' : target}/.env.example + apps/sim/.env`
        : 'run: bun run setup',
      autofix: canSeed
        ? () => {
            const keys = target === 'db' ? ['DATABASE_URL'] : [...SHARED_KEYS]
            const values: Record<string, string> = {}
            for (const key of keys) {
              const value = ctx.env.sim.vars.get(key)
              if (value) values[key] = value
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
  for (const target of ['sim', 'realtime', 'db'] as const) {
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
  const sim = ctx.env.sim
  if (!sim.exists) return findings
  if (isTruthy(sim.vars.get('TRIGGER_DEV_ENABLED'))) {
    const missing = ['TRIGGER_SECRET_KEY', 'TRIGGER_PROJECT_ID'].filter((k) => !sim.vars.get(k))
    if (missing.length > 0) {
      findings.push({
        group: 'coherence',
        status: 'fail',
        message: `TRIGGER_DEV_ENABLED is on but ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not set`,
        fix: 'set the missing Trigger.dev vars or remove TRIGGER_DEV_ENABLED (jobs fall back to the DB queue)',
      })
    }
  }
  const redisUrl = sim.vars.get('REDIS_URL')
  if (redisUrl?.startsWith('rediss://')) {
    const host = new URL(redisUrl).hostname
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && !sim.vars.get('REDIS_TLS_SERVERNAME')) {
      findings.push({
        group: 'coherence',
        status: 'fail',
        message:
          'rediss:// with a bare IP host requires REDIS_TLS_SERVERNAME — the redis client throws without it',
        fix: 'set REDIS_TLS_SERVERNAME to the certificate hostname',
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
  const hasS3 = Boolean(sim.vars.get('AWS_REGION') && sim.vars.get('S3_BUCKET_NAME'))
  const s3Partial = Boolean(sim.vars.get('AWS_REGION')) !== Boolean(sim.vars.get('S3_BUCKET_NAME'))
  const hasAzure = Boolean(
    sim.vars.get('AZURE_CONNECTION_STRING') || sim.vars.get('AZURE_ACCOUNT_NAME')
  )
  const azurePartial =
    Boolean(sim.vars.get('AZURE_ACCOUNT_NAME')) &&
    !sim.vars.get('AZURE_ACCOUNT_KEY') &&
    !sim.vars.get('AZURE_CONNECTION_STRING')
  const hasGcs = Boolean(sim.vars.get('GCS_BUCKET_NAME'))
  if (s3Partial) {
    findings.push({
      group: 'coherence',
      status: 'fail',
      message:
        'S3 is half-configured (need BOTH AWS_REGION and S3_BUCKET_NAME) — storage silently falls back to local disk',
      fix: 'set the missing var, or remove both to use local disk intentionally',
    })
  }
  if (azurePartial) {
    findings.push({
      group: 'coherence',
      status: 'fail',
      message:
        'Azure storage is half-configured — AZURE_ACCOUNT_NAME needs AZURE_ACCOUNT_KEY (or use AZURE_CONNECTION_STRING)',
      fix: 'set the missing credential, or remove the Azure vars',
    })
  }
  if (hasAzure && hasS3) {
    findings.push({
      group: 'coherence',
      status: 'warn',
      message:
        'both Azure Blob and S3 are configured — Azure takes precedence, the S3 vars are ignored',
      fix: 'remove the backend you are not using',
    })
  }
  if (hasGcs && (hasAzure || hasS3)) {
    findings.push({
      group: 'coherence',
      status: 'warn',
      message:
        'GCS is configured alongside Azure/S3 — GCS is only used when neither of those is set',
      fix: 'remove the backend you are not using',
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
      autofix: () => writeEnvValues('sim', { [missingSide]: value }),
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

  if (isTruthy(sim.vars.get('EMAIL_VERIFICATION_ENABLED')) && !hasMailProvider(sim.vars)) {
    findings.push({
      group: 'coherence',
      status: 'fail',
      message:
        'EMAIL_VERIFICATION_ENABLED is on but no mail provider is configured — verification emails only go to the console, locking out new users',
      fix: 'configure RESEND_API_KEY / SMTP_* / AWS_SES_REGION, or turn verification off',
    })
  }

  const featureRules: Array<{ flag: string; needs: string[]; label: string }> = [
    { flag: 'BILLING_ENABLED', needs: ['STRIPE_SECRET_KEY'], label: 'billing' },
    { flag: 'E2B_ENABLED', needs: ['E2B_API_KEY'], label: 'E2B code execution' },
    { flag: 'SSO_ENABLED', needs: ['SSO_ISSUER'], label: 'SSO' },
  ]
  for (const rule of featureRules) {
    if (!isTruthy(sim.vars.get(rule.flag))) continue
    const missing = rule.needs.filter((key) => !sim.vars.get(key))
    if (missing.length > 0) {
      findings.push({
        group: 'coherence',
        status: 'fail',
        message: `${rule.flag} is on but ${missing.join(', ')} is not set — ${rule.label} will fail at runtime`,
        fix: `set ${missing.join(', ')} or remove ${rule.flag}`,
      })
    }
  }
  if (
    isTruthy(sim.vars.get('PII_GRANULAR_REDACTION')) &&
    !isTruthy(sim.vars.get('PII_REDACTION'))
  ) {
    findings.push({
      group: 'coherence',
      status: 'warn',
      message:
        'PII_GRANULAR_REDACTION is on but PII_REDACTION is off — the granular flag is inert without it',
      fix: 'set PII_REDACTION=true or remove PII_GRANULAR_REDACTION',
    })
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
    findings.push({ group: 'coherence', status: 'pass', message: 'no conflicting settings' })
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
        fix: 'start Postgres (bun run setup can manage a pgvector container) or fix DATABASE_URL',
      })
    } else {
      findings.push({ group: 'live', status: 'pass', message: 'database reachable' })
      if (!probe.pgvectorAvailable) {
        findings.push({
          group: 'live',
          status: 'fail',
          message: 'pgvector extension is not available on this Postgres',
          fix: 'use the pgvector/pgvector:pg17 image or install the extension',
        })
      }
      const { applied, journal } = probe.migrations ?? { applied: null, journal: 0 }
      if (applied === null) {
        findings.push({
          group: 'live',
          status: 'fail',
          message: 'migrations have never run on this database',
          fix: 'cd packages/db && bun run db:migrate',
        })
      } else if (applied < journal) {
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
          message: `migrations up to date (${applied})`,
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
  const redisUrl = sim.vars.get('REDIS_URL')
  if (!redisUrl) return []
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
    return [{ group: 'live', status: 'skip', message: `${label}: not running on :${port}` }]
  }
  if (await httpHealth(url)) {
    return [{ group: 'live', status: 'pass', message: `${label} healthy on :${port}` }]
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
  const sim = ctx.env.sim
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
