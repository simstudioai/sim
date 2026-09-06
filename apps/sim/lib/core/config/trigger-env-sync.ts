import { createLogger } from '@sim/logger'
import { fetchSecretMap } from '@sim/runtime-secrets'
import { getErrorMessage } from '@sim/utils/errors'

const logger = createLogger('TriggerEnvSync')

/**
 * One variable to publish into the Trigger.dev environment being deployed.
 * Mirrors the shape `syncEnvVars` accepts.
 */
export interface SyncedEnvVar {
  name: string
  value: string
  isSecret: boolean
}

/**
 * Values that are the same in every environment, so they need no secret lookup
 * and are published even when the lookup fails.
 *
 * Nothing here may start with `TRIGGER_`: `syncEnvVars` drops every key with
 * that prefix before it builds its layer, so such an entry looks published and
 * never is. `TRIGGER_DEV_ENABLED` used to sit in this list for exactly that
 * reason and had no effect for the life of the config; workers that need it get
 * it from the Trigger.dev dashboard, and run dispatch does not read it at all
 * because the `init` hook in `trigger.config.ts` marks the run process directly.
 */
const CONSTANT_ENV: readonly SyncedEnvVar[] = [
  { name: 'DB_APP_NAME', value: 'sim-trigger', isSecret: false },
] as const

/** Prefix `syncEnvVars` strips from any key it is handed. */
const UNSYNCABLE_PREFIX = 'TRIGGER_'

/**
 * Environment a run needs for sandboxed work. Function block runs and the
 * document compiler share one provider selection, and the doc-template
 * variables decide whether a run reads a generated document through the doc
 * sandbox's artifact store or the isolated-vm fallback. The app authors
 * documents for whichever compiler it sees, so a worker missing the doc
 * template falls back to isolated-vm and tries to run Python or Node-style
 * sources as sandbox JavaScript. Reading a generated document under the doc
 * sandbox means loading its compiled artifact from the copilot storage
 * context, so that bucket has to be visible to the run as well.
 *
 * To give workers a new variable, add its key here and set it in the
 * `/{env}/sim/env-vars` secret. The next deploy publishes it; nothing has to be
 * entered in the Trigger.dev dashboard by hand.
 */
export const WORKER_SECRET_KEYS: readonly { name: string; secret: boolean }[] = [
  { name: 'REDIS_URL', secret: true },
  { name: 'REDIS_TLS_SERVERNAME', secret: false },
  { name: 'SANDBOX_PROVIDER', secret: false },
  { name: 'E2B_ENABLED', secret: false },
  { name: 'E2B_API_KEY', secret: true },
  { name: 'E2B_FUNCTION_TEMPLATE_ID', secret: false },
  { name: 'E2B_FUNCTION_TEMPLATE_GENERATION', secret: false },
  { name: 'MOTHERSHIP_E2B_DOC_TEMPLATE_ID', secret: false },
  { name: 'DAYTONA_API_KEY', secret: true },
  { name: 'DAYTONA_FUNCTION_SNAPSHOT_ID', secret: false },
  { name: 'DAYTONA_DOC_SNAPSHOT_ID', secret: false },
  { name: 'S3_COPILOT_BUCKET_NAME', secret: false },
  { name: 'AZURE_STORAGE_COPILOT_CONTAINER_NAME', secret: false },
  { name: 'GCS_COPILOT_BUCKET_NAME', secret: false },
] as const

/**
 * Secret backing each Trigger.dev deploy target. `preview` is the `dev-sim`
 * branch CI deploys from the `dev` branch, so it reads the dev environment's
 * secret. A target absent from this map gets the constants and nothing else —
 * guessing a secret would risk publishing one environment's credentials into
 * another, which `syncEnvVars` would then apply with `override: true`.
 */
export const SECRET_ID_BY_ENVIRONMENT: Readonly<Record<string, string>> = {
  prod: '/production/sim/env-vars',
  staging: '/staging/sim/env-vars',
  preview: '/dev/sim/env-vars',
} as const

/**
 * Resolves the variables to publish into one Trigger.dev environment, reading
 * them from the same Secrets Manager entry the app container boots from, so the
 * two runtimes cannot drift.
 *
 * Never throws. `syncEnvVars` swallows a callback rejection and then publishes
 * *nothing*, which would silently drop the constants too, so a failed or
 * incomplete lookup degrades to publishing what is known rather than aborting.
 * Keys the secret does not carry are logged by name and simply not published —
 * several are optional (Azure and GCS buckets on an S3 deployment, for one), so
 * their absence is normal rather than an error, and leaving them out preserves
 * whatever the Trigger.dev environment already held.
 *
 * @param environment Trigger.dev deploy target (`prod`, `staging`, `preview`).
 * @param loadSecret Secret reader, injectable for tests.
 */
export async function resolveTriggerEnvVars(
  environment: string,
  loadSecret: (secretId: string) => Promise<Record<string, unknown>> = fetchSecretMap
): Promise<SyncedEnvVar[]> {
  const secretId = SECRET_ID_BY_ENVIRONMENT[environment]
  if (!secretId) {
    logger.warn(
      `No secret mapped for Trigger.dev environment "${environment}"; publishing constants only`
    )
    return [...CONSTANT_ENV]
  }

  let entries: Record<string, unknown>
  try {
    entries = await loadSecret(secretId)
  } catch (error) {
    logger.error(
      `Failed to read ${secretId}; publishing constants only. Worker env is unchanged from the previous deploy.`,
      { error: getErrorMessage(error) }
    )
    return [...CONSTANT_ENV]
  }

  const resolved: SyncedEnvVar[] = [...CONSTANT_ENV]
  const missing: string[] = []

  for (const { name, secret } of WORKER_SECRET_KEYS) {
    const value = normalizeSecretValue(entries[name])
    if (value === undefined) {
      missing.push(name)
      continue
    }
    resolved.push({ name, value, isSecret: secret })
  }

  if (missing.length > 0) {
    logger.info(
      `${missing.length} worker env var(s) not set in ${secretId}; they are left untouched in Trigger.dev`,
      { missing }
    )
  }

  logger.info('Resolved Trigger.dev env vars', {
    environment,
    secretId,
    published: resolved.length,
    missing: missing.length,
  })

  return resolved
}

/**
 * Coerces a secret entry to an env var value, matching how container boot
 * hydrates `process.env`. An absent or empty value is treated as unset so a
 * blank secret entry cannot overwrite a working dashboard value with `''`.
 */
function normalizeSecretValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const normalized = typeof value === 'string' ? value : JSON.stringify(value)
  return normalized === '' ? undefined : normalized
}

/**
 * Guards the one silent failure this module cannot otherwise surface: a key the
 * sync layer strips is indistinguishable, in the deploy log, from one it
 * published.
 *
 * Called at module load rather than per resolve, so a key added to the wrong
 * list fails config evaluation — and therefore the deploy and the test run —
 * instead of reaching {@link resolveTriggerEnvVars}, whose contract is to
 * degrade rather than throw.
 */
export function assertSyncableKeys(
  names: readonly string[] = [
    ...CONSTANT_ENV.map((v) => v.name),
    ...WORKER_SECRET_KEYS.map((k) => k.name),
  ]
): void {
  const stripped = names.filter((name) => name.startsWith(UNSYNCABLE_PREFIX))

  if (stripped.length > 0) {
    throw new Error(
      `syncEnvVars strips ${UNSYNCABLE_PREFIX}-prefixed keys, so these can never reach a worker and must be set in the Trigger.dev dashboard: ${stripped.join(', ')}`
    )
  }
}

assertSyncableKeys()
