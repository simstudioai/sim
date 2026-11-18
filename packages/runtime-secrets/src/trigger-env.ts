/**
 * The app's env-vars secret each Trigger.dev environment mirrors, keyed by the
 * environment slug a deploy targets. Pinned here rather than passed in, so a
 * deploy can never sync one environment's configuration into another.
 */
export const APP_ENV_SECRET_IDS: Record<string, string> = {
  prod: '/production/sim/env-vars',
  staging: '/staging/sim/env-vars',
  preview: '/dev/sim/env-vars',
}

/** Values every Trigger.dev environment runs with, overriding the app secret. */
export const TRIGGER_CONSTANT_VARS = [
  { name: 'DB_APP_NAME', value: 'sim-trigger', isSecret: false },
  { name: 'SIM_DB_ROLE', value: 'trigger', isSecret: false },
]

/**
 * App keys whose Trigger.dev value must differ from the app's, or that a run
 * must never hold. The sync leaves them out entirely, so the value already set
 * in the Trigger.dev environment (if any) stays as it is.
 */
const TRIGGER_OWNED_KEYS: ReadonlySet<string> = new Set([
  // Workers run outside the VPC and reach Redis through their own endpoint.
  'REDIS_URL',
  'REDIS_TLS_SERVERNAME',
  // A VPC-internal base URL is unreachable from Trigger.dev's cloud.
  'INTERNAL_API_BASE_URL',
  // The app dials an egress gateway through the VPC load balancer; workers dial it through their
  // own endpoint, so each gateway's `url` differs. The credentials and routing source are shared.
  'OUTBOUND_GATEWAYS',
  // Schema-migration credential: runs never migrate, so they never hold it.
  'MIGRATION_DATABASE_URL',
  // `syncEnvVars` refuses to sync it, so it can only ever be set by hand.
  'GITHUB_TOKEN',
])

const TRIGGER_OWNED_PREFIXES = [
  // Runs authenticate to AWS through workload identity, never static keys.
  'AWS_',
  // Trigger.dev configures each run's OTLP exporter; the app's collector is not the run's.
  'OTEL_EXPORTER_OTLP_',
  // The platform owns these, and `syncEnvVars` drops the prefix anyway.
  'TRIGGER_',
] as const

interface TriggerEnvVar {
  name: string
  value: string
  isSecret: boolean
}

function isTriggerOwned(key: string): boolean {
  return TRIGGER_OWNED_KEYS.has(key) || TRIGGER_OWNED_PREFIXES.some((p) => key.startsWith(p))
}

/**
 * The variables a Trigger.dev environment syncs from the app's env-vars
 * secret: every app key except the Trigger-owned ones, then the Trigger
 * constants. App values are secrets unless the key is a `NEXT_PUBLIC_*` value
 * the browser already receives.
 */
export function buildTriggerEnvVars(appEnv: Record<string, string>): TriggerEnvVar[] {
  const constantNames = new Set(TRIGGER_CONSTANT_VARS.map((v) => v.name))
  const fromApp = Object.entries(appEnv)
    .filter(([name]) => !isTriggerOwned(name) && !constantNames.has(name))
    .map(([name, value]) => ({ name, value, isSecret: !name.startsWith('NEXT_PUBLIC_') }))
  if (fromApp.length === 0) throw new Error('The app env-vars secret has no variables to sync')
  return [...fromApp, ...TRIGGER_CONSTANT_VARS]
}

/** Splits `vars` into those `current` lacks and those it holds with another value. */
export function diffTriggerEnv(vars: TriggerEnvVar[], current: Record<string, string>) {
  return {
    added: vars.filter((v) => !(v.name in current)),
    changed: vars.filter((v) => v.name in current && current[v.name] !== v.value),
  }
}

/**
 * Parses the `TRIGGER_ENV_SYNC_TARGETS` repository variable: an exact comma list of Trigger.dev
 * environment slugs, such as `preview,staging,prod`. The deploy workflows decide whether to grant
 * the secret-read credentials by matching that same exact list, so an entry they would not match
 * (padded, empty, or a slug with no mapped secret) fails the deploy here rather than syncing
 * without credentials or silently keeping the environment on its old configuration.
 */
export function parseTriggerEnvSyncTargets(value: string | undefined): Set<string> {
  if (!value) return new Set()
  const targets = value.split(',')
  const invalid = targets.filter((target) => !Object.hasOwn(APP_ENV_SECRET_IDS, target))
  if (invalid.length > 0) {
    throw new Error(
      `TRIGGER_ENV_SYNC_TARGETS must be a comma list of ${Object.keys(APP_ENV_SECRET_IDS).join(', ')} with no spaces; refused: ${invalid.map((target) => JSON.stringify(target)).join(', ')}`
    )
  }
  return new Set(targets)
}

/** Reads the app env-vars secret mapped to `environment` and builds its Trigger.dev variables. */
export async function resolveTriggerEnvFromAppSecret(environment: string) {
  const secretId = Object.hasOwn(APP_ENV_SECRET_IDS, environment)
    ? APP_ENV_SECRET_IDS[environment]
    : undefined
  if (!secretId) {
    throw new Error(`No app env-vars secret is mapped to Trigger.dev environment '${environment}'`)
  }
  const { fetchRuntimeSecrets } = await import('./index')
  return { secretId, vars: buildTriggerEnvVars(await fetchRuntimeSecrets(secretId)) }
}
