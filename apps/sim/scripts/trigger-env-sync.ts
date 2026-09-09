import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import {
  CACHE_CAPABILITY,
  type CapabilityDefinition,
  EMAIL_CAPABILITY,
  getCapabilityFields,
  hasEnvCapabilityValue,
  inspectCapability,
  inspectOAuthClientCapability,
  isTruthyEnvCapabilityValue,
  KNOWLEDGE_EMBEDDINGS_CAPABILITY,
  LLM_KEY_POOLS,
  OAUTH_CLIENT_CAPABILITIES,
  OCR_CAPABILITY,
  SANDBOX_CAPABILITY,
  STORAGE_CAPABILITY,
} from '@sim/deployment-config/env-capabilities'
import { createLogger } from '@sim/logger'
import type { syncEnvVars } from '@trigger.dev/build/extensions/core'

const logger = createLogger('TriggerEnvSync')
type SyncContext = Parameters<Parameters<typeof syncEnvVars>[0]>[0]

interface DeploymentConfiguration {
  expectedProjectRef?: string
  region?: string
}

interface WorkerVariable {
  name: string
  isSecret: boolean
  consumer: string
  requiredness: 'required' | 'capability' | 'optional'
}

/** Conservative ownership until each target's configuration owner approves a transfer. */
const WORKER_OWNED = [
  'DATABASE_URL',
  'DATABASE_URL_WEB',
  'DATABASE_URL_TRIGGER',
  'DATABASE_URL_REALTIME',
  'DATABASE_URL_CLEANUP',
  'DATABASE_URL_EXEC',
  'DATABASE_REPLICA_URL',
  'DATABASE_REPLICA_URL_WEB',
  'DATABASE_REPLICA_URL_TRIGGER',
  'DATABASE_REPLICA_URL_REALTIME',
  'SIM_DB_ROLE',
  'REDIS_URL',
  'REDIS_TLS_SERVERNAME',
  'PII_URL',
  'GRAFANA_OTLP_ENDPOINT',
  'GRAFANA_OTLP_HEADERS',
  'GRAFANA_DEPLOYMENT_ENVIRONMENT',
] as const

const TARGETS = {
  'preview/dev-sim': { secretId: '/dev/sim/env-vars', workerOwned: WORKER_OWNED },
  staging: { secretId: '/staging/sim/env-vars', workerOwned: WORKER_OWNED },
  prod: { secretId: '/production/sim/env-vars', workerOwned: WORKER_OWNED },
} as const

type Target = keyof typeof TARGETS

/** Errors expose only controlled categories and allowlisted names, never underlying messages. */
class SyncFailure extends Error {
  constructor(
    readonly category: string,
    readonly names: readonly string[] = []
  ) {
    super(
      `Worker configuration sync failed: ${category}${names.length ? ` (${names.join(', ')})` : ''}`
    )
  }
}

export function resolveWorkerSyncTarget(
  context: SyncContext,
  configuration: DeploymentConfiguration
) {
  if (
    !configuration.expectedProjectRef ||
    context.projectRef !== configuration.expectedProjectRef
  ) {
    throw new SyncFailure('project')
  }
  if (!configuration.region || !/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(configuration.region)) {
    throw new SyncFailure('region')
  }
  const target: Target | undefined =
    context.environment === 'preview' && context.branch === 'dev-sim'
      ? 'preview/dev-sim'
      : context.branch === undefined &&
          (context.environment === 'staging' || context.environment === 'prod')
        ? context.environment
        : undefined
  if (!target) throw new SyncFailure('target')
  return { target, region: configuration.region, ...TARGETS[target] }
}

const CAPABILITIES: readonly CapabilityDefinition[] = [
  STORAGE_CAPABILITY,
  SANDBOX_CAPABILITY,
  EMAIL_CAPABILITY,
  OCR_CAPABILITY,
  KNOWLEDGE_EMBEDDINGS_CAPABILITY,
  CACHE_CAPABILITY,
]

/** New shared fields default to secret; only explicitly reviewed configuration is public. */
const PUBLIC_CAPABILITY_FIELDS = new Set([
  'STORAGE_PROVIDER',
  'SANDBOX_PROVIDER',
  'OCR_PROVIDER',
  'E2B_ENABLED',
  'NEXT_PUBLIC_E2B_ENABLED',
  'NEXT_PUBLIC_SANDBOXES_ENABLED',
  'E2B_FUNCTION_TEMPLATE_ID',
  'E2B_FUNCTION_TEMPLATE_GENERATION',
  'DAYTONA_FUNCTION_SNAPSHOT_ID',
  'AWS_REGION',
  'AWS_SES_REGION',
  'S3_ENDPOINT',
  'S3_FORCE_PATH_STYLE',
  'S3_BUCKET_NAME',
  'S3_KB_BUCKET_NAME',
  'S3_EXECUTION_FILES_BUCKET_NAME',
  'S3_CHAT_BUCKET_NAME',
  'S3_COPILOT_BUCKET_NAME',
  'S3_PROFILE_PICTURES_BUCKET_NAME',
  'S3_OG_IMAGES_BUCKET_NAME',
  'S3_WORKSPACE_LOGOS_BUCKET_NAME',
  'AZURE_ACCOUNT_NAME',
  'AZURE_STORAGE_CONTAINER_NAME',
  'GCS_BUCKET_NAME',
  'GCS_PROJECT_ID',
  'SMTP_HOST',
  'SMTP_PORT',
  'GMAIL_SENDER',
  'OCR_AZURE_ENDPOINT',
  'OCR_AZURE_MODEL_NAME',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_API_VERSION',
  'KB_OPENAI_MODEL_NAME',
  'KB_EMBEDDING_MODEL',
  'EMBEDDING_OUTPUT_DIMS',
  'OLLAMA_URL',
  'REDIS_TLS_SERVERNAME',
])

function variables(
  names: readonly string[],
  consumer: string,
  isSecret: boolean,
  requiredness: WorkerVariable['requiredness'] = 'optional'
): WorkerVariable[] {
  return names.map((name) => ({ name, consumer, isSecret, requiredness }))
}

/**
 * Platform configuration only. OAuth entries are application client registrations;
 * account tokens, workspace secrets and customer provider keys stay in the database.
 * Each additional group records its in-worker consumer and presence policy.
 */
export const WORKER_CONFIGURATION: readonly WorkerVariable[] = [
  ...CAPABILITIES.flatMap((capability) =>
    getCapabilityFields(capability).map((name) => ({
      name,
      consumer: `shared capability: ${capability.id}`,
      isSecret: !PUBLIC_CAPABILITY_FIELDS.has(name),
      requiredness: 'capability' as const,
    }))
  ),
  ...Object.entries(OAUTH_CLIENT_CAPABILITIES).flatMap(([provider, names]) =>
    names.map((name) => ({
      name,
      consumer: `OAuth refresh: ${provider}`,
      isSecret: !name.endsWith('_CLIENT_ID'),
      requiredness: 'capability' as const,
    }))
  ),
  ...Object.values(LLM_KEY_POOLS).flatMap((pool) =>
    variables(
      [...pool.keys, ...('fallbackKey' in pool ? [pool.fallbackKey] : [])],
      'providers/utils.ts: platform LLM key pools',
      true,
      'capability'
    )
  ),
  ...variables(
    ['BETTER_AUTH_SECRET', 'ENCRYPTION_KEY', 'INTERNAL_API_SECRET'],
    'auth, credential decryption and internal operation authentication',
    true,
    'required'
  ),
  ...variables(
    ['BETTER_AUTH_URL', 'NEXT_PUBLIC_APP_URL'],
    'auth callbacks, execution URLs and env-flags hosted detection',
    false,
    'required'
  ),
  ...variables(
    ['API_ENCRYPTION_KEY', 'INTERNAL_JWT_SECRET'],
    'lib/core/security: dedicated encryption and internal JWT keys',
    true
  ),
  ...variables(
    WORKER_OWNED.filter((name) => name.startsWith('DATABASE_')),
    'packages/db: process, replica and cleanup/exec pools; Trigger-owned',
    true
  ),
  ...variables(['SIM_DB_ROLE'], 'packages/db: existing process pool profile; Trigger-owned', false),
  ...variables(['PII_URL'], 'lib/execution: payload redaction endpoint; Trigger-owned', false),
  ...variables(['GRAFANA_OTLP_HEADERS'], 'trigger.config.ts: telemetry; Trigger-owned', true),
  ...variables(
    ['GRAFANA_OTLP_ENDPOINT', 'GRAFANA_DEPLOYMENT_ENVIRONMENT'],
    'trigger.config.ts: telemetry; Trigger-owned',
    false
  ),
  ...variables(
    [
      'MOTHERSHIP_E2B_DOC_TEMPLATE_ID',
      'MOTHERSHIP_E2B_TEMPLATE_ID',
      'E2B_PI_TEMPLATE_ID',
      'E2B_DOMAIN',
      'DAYTONA_DOC_SNAPSHOT_ID',
      'DAYTONA_SHELL_SNAPSHOT_ID',
      'DAYTONA_PI_SNAPSHOT_ID',
    ],
    'lib/execution/sandbox: document, shell and agent sandbox selection',
    false,
    'capability'
  ),
  ...variables(
    [
      'AZURE_STORAGE_KB_CONTAINER_NAME',
      'AZURE_STORAGE_EXECUTION_FILES_CONTAINER_NAME',
      'AZURE_STORAGE_CHAT_CONTAINER_NAME',
      'AZURE_STORAGE_COPILOT_CONTAINER_NAME',
      'AZURE_STORAGE_PROFILE_PICTURES_CONTAINER_NAME',
      'AZURE_STORAGE_OG_IMAGES_CONTAINER_NAME',
      'AZURE_STORAGE_WORKSPACE_LOGOS_CONTAINER_NAME',
      'GCS_KB_BUCKET_NAME',
      'GCS_EXECUTION_FILES_BUCKET_NAME',
      'GCS_CHAT_BUCKET_NAME',
      'GCS_COPILOT_BUCKET_NAME',
      'GCS_PROFILE_PICTURES_BUCKET_NAME',
      'GCS_OG_IMAGES_BUCKET_NAME',
      'GCS_WORKSPACE_LOGOS_BUCKET_NAME',
    ],
    'lib/uploads/config.ts: worker file-storage contexts',
    false,
    'capability'
  ),
  ...variables(
    ['EMAIL_DOMAIN', 'FROM_EMAIL_ADDRESS', 'PERSONAL_EMAIL_FROM', 'SMTP_SECURE', 'SMTP_EHLO_NAME'],
    'lib/messaging/email: background notification sender',
    false
  ),
  ...variables(
    ['BILLING_ENABLED', 'ENTERPRISE_ENABLED'],
    'lib/core/config/env-flags: billing and enterprise execution policy',
    false,
    'required'
  ),
  ...variables(
    [
      'INBOX_ENABLED',
      'SANDBOXES_ENABLED',
      'ACCESS_CONTROL_ENABLED',
      'ORGANIZATIONS_ENABLED',
      'USAGE_MONITORING_ENABLED',
      'DATA_RETENTION_ENABLED',
      'DATA_DRAINS_ENABLED',
      'AUDIT_LOGS_ENABLED',
      'COPILOT_TOOL_PERMISSIONS_ENABLED',
      'DURABLE_SECRET_PROVENANCE_ENFORCED_SURFACES',
      'ALLOWED_INTEGRATIONS',
      'BLACKLISTED_PROVIDERS',
      'ALLOWED_MCP_DOMAINS',
      'EGRESS_ALLOWED_HOSTS',
      'EGRESS_ALLOWED_IP_RANGES',
      'ALLOW_PRIVATE_DATABASE_HOSTS',
    ],
    'env-flags and execution policy: hosted feature and egress gates',
    false
  ),
  ...variables(
    ['STRIPE_SECRET_KEY'],
    'lib/billing: usage and subscription jobs',
    true,
    'capability'
  ),
  ...variables(
    [
      'STRIPE_FREE_PRICE_ID',
      'STRIPE_PRO_PRICE_ID',
      'STRIPE_TEAM_PRICE_ID',
      'STRIPE_ENTERPRISE_PRICE_ID',
      'STRIPE_PRICE_TIER_25_MO',
      'STRIPE_PRICE_TIER_100_MO',
      'STRIPE_PRICE_TIER_25_YR',
      'STRIPE_PRICE_TIER_100_YR',
      'STRIPE_PRICE_TEAM_25_MO',
      'STRIPE_PRICE_TEAM_25_YR',
      'STRIPE_PRICE_TEAM_100_MO',
      'STRIPE_PRICE_TEAM_100_YR',
      'FREE_TIER_COST_LIMIT',
      'PRO_TIER_COST_LIMIT',
      'TEAM_TIER_COST_LIMIT',
      'ENTERPRISE_TIER_COST_LIMIT',
      'FREE_STORAGE_LIMIT_GB',
      'PRO_STORAGE_LIMIT_GB',
      'TEAM_STORAGE_LIMIT_GB',
      'BILLING_CONCURRENCY_LIMIT_PRO',
      'BILLING_CONCURRENCY_LIMIT_TEAM',
      'BILLING_CONCURRENCY_LIMIT_ENTERPRISE',
      'COST_MULTIPLIER',
      'OVERAGE_THRESHOLD_DOLLARS',
    ],
    'lib/billing: plan limits, price lookup and usage enforcement',
    false
  ),
  ...variables(
    ['APPCONFIG_APPLICATION', 'APPCONFIG_ENVIRONMENT'],
    'lib/core/config: hosted access-control AppConfig client',
    false,
    'capability'
  ),
  ...variables(['AGENTMAIL_API_KEY'], 'lib/mothership: inbox service', true, 'capability'),
  ...variables(['AGENTMAIL_DOMAIN'], 'lib/mothership: inbox domain', false),
  ...variables(
    ['COPILOT_API_KEY'],
    'lib/mothership: agent service authentication',
    true,
    'capability'
  ),
  ...variables(
    ['SIM_AGENT_API_URL', 'COPILOT_SOURCE_ENV'],
    'lib/mothership: agent service routing',
    false
  ),
]

function serializeValue(value: unknown, name: string): string | undefined {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return
  if (typeof value === 'string') return value
  if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))
    return JSON.stringify(value)
  if (name.endsWith('_JSON') && typeof value === 'object' && !Array.isArray(value))
    return JSON.stringify(value)
  throw new SyncFailure('value-type', [name])
}

function validateCapabilities(values: Record<string, string>) {
  for (const definition of CAPABILITIES) {
    const inspection = inspectCapability(definition, values)
    const broken = inspection.providers.filter(
      (provider) => provider.state === 'partial' || provider.state === 'invalid'
    )
    if (inspection.error || broken.length) {
      throw new SyncFailure('capability', getCapabilityFields(definition))
    }
  }
  for (const provider of Object.keys(OAUTH_CLIENT_CAPABILITIES)) {
    const inspection = inspectOAuthClientCapability(provider, values)
    if (inspection.state === 'partial')
      throw new SyncFailure('oauth-pair', inspection.missingFields)
  }
  for (const [flag, required] of [
    ['BILLING_ENABLED', 'STRIPE_SECRET_KEY'],
    ['INBOX_ENABLED', 'AGENTMAIL_API_KEY'],
  ]) {
    if (isTruthyEnvCapabilityValue(values, flag) && !hasEnvCapabilityValue(values, required)) {
      throw new SyncFailure('enabled-feature', [required])
    }
  }
  if (values.APPCONFIG_APPLICATION || values.APPCONFIG_ENVIRONMENT) {
    for (const name of ['APPCONFIG_APPLICATION', 'APPCONFIG_ENVIRONMENT', 'AWS_REGION']) {
      if (!hasEnvCapabilityValue(values, name)) throw new SyncFailure('appconfig', [name])
    }
  }
}

function validateCore(values: Record<string, string>) {
  for (const name of [
    'BETTER_AUTH_SECRET',
    'INTERNAL_API_SECRET',
    'INTERNAL_JWT_SECRET',
    'API_ENCRYPTION_KEY',
  ]) {
    if (values[name] !== undefined && values[name].trim().length < 32)
      throw new SyncFailure('authentication', [name])
  }
  if (!/^[a-fA-F0-9]{64}$/.test(values.ENCRYPTION_KEY))
    throw new SyncFailure('encryption', ['ENCRYPTION_KEY'])
  for (const name of ['NEXT_PUBLIC_APP_URL', 'BETTER_AUTH_URL']) {
    try {
      if (!['https:', 'http:'].includes(new URL(values[name]).protocol)) throw new Error()
    } catch {
      throw new SyncFailure('url', [name])
    }
  }
  for (const name of ['BILLING_ENABLED', 'ENTERPRISE_ENABLED']) {
    if (!/^(true|false|1|0|yes|no|on|off)$/i.test(values[name].trim()))
      throw new SyncFailure('boolean', [name])
  }
}

/** Select source-owned values without using the deployer's runtime environment as fallback. */
export function selectWorkerConfiguration(
  source: Record<string, unknown>,
  current: Record<string, string>,
  target: Target
) {
  const owned = new Set<string>(TARGETS[target].workerOwned)
  const policy = new Map(WORKER_CONFIGURATION.map((entry) => [entry.name, entry]))
  const selected: Record<string, string> = {}
  const effective: Record<string, string> = {}
  const omitted: string[] = []
  for (const [name, entry] of policy) {
    if (name.startsWith('TRIGGER_')) continue
    if (Object.hasOwn(current, name)) effective[name] = current[name]
    if (owned.has(name)) {
      if (Object.hasOwn(current, name)) selected[name] = current[name]
      continue
    }
    const value = serializeValue(Object.hasOwn(source, name) ? source[name] : undefined, name)
    if (value === undefined) {
      if (entry.requiredness === 'required') throw new SyncFailure('required', [name])
      if (Object.hasOwn(current, name)) omitted.push(name)
    } else {
      selected[name] = value
      effective[name] = value
    }
  }
  validateCore(selected)
  validateCore(effective)
  validateCapabilities(selected)
  validateCapabilities(effective)
  for (const definition of CAPABILITIES) {
    if (definition.strategy !== 'selected' || definition === CACHE_CAPABILITY) continue
    if (!getCapabilityFields(definition).some((name) => hasEnvCapabilityValue(selected, name)))
      continue
    const intended = inspectCapability(definition, selected)
    const actual = inspectCapability(definition, effective)
    if (intended.providerId !== actual.providerId) {
      throw new SyncFailure('preserved-provider-conflict', getCapabilityFields(definition))
    }
  }
  const role = current.SIM_DB_ROLE?.trim() || 'web'
  if (!['web', 'trigger', 'realtime'].includes(role))
    throw new SyncFailure('database-role', ['SIM_DB_ROLE'])
  const databaseKey = `DATABASE_URL_${role.toUpperCase()}`
  const databaseUrl = current[databaseKey] ?? current.DATABASE_URL
  try {
    if (
      !databaseUrl ||
      !['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol) ||
      !new URL(databaseUrl).hostname
    )
      throw new Error()
  } catch {
    throw new SyncFailure('database', [databaseKey, 'DATABASE_URL'])
  }
  return {
    variables: [
      { name: 'DB_APP_NAME', value: 'sim-trigger', isSecret: false },
      ...Object.entries(selected).flatMap(([name, value]) =>
        owned.has(name)
          ? []
          : [
              {
                name,
                value,
                isSecret: policy.get(name)!.isSecret,
              },
            ]
      ),
    ],
    omitted,
  }
}

/** Bounded default-chain AWS access. The combined object is never hydrated or persisted. */
export async function readWorkerConfiguration(
  context: SyncContext,
  configuration: DeploymentConfiguration
) {
  const mapping = resolveWorkerSyncTarget(context, configuration)
  const client = new SecretsManagerClient({ region: mapping.region, maxAttempts: 3 })
  let source: unknown
  try {
    let secretString: string | undefined
    try {
      const response = await client.send(
        new GetSecretValueCommand({
          SecretId: mapping.secretId,
          VersionStage: 'AWSCURRENT',
        }),
        { abortSignal: AbortSignal.timeout(15_000) }
      )
      secretString = response.SecretString
    } catch {
      throw new SyncFailure('aws-fetch')
    }
    if (!secretString) throw new SyncFailure('secret-format')
    try {
      source = JSON.parse(secretString)
    } catch {
      throw new SyncFailure('secret-json')
    }
  } finally {
    client.destroy()
  }
  if (!source || typeof source !== 'object' || Array.isArray(source))
    throw new SyncFailure('secret-object')
  return selectWorkerConfiguration(source as Record<string, unknown>, context.env, mapping.target)
}

/**
 * Trigger 4.5.12 catches callback exceptions and continues the build. Exit the
 * deployment process on failure; throwing or returning [] is not a release gate.
 * Configuration comes from deployment wiring, never from the fetched source.
 */
export async function syncWorkerEnvironment(context: SyncContext) {
  try {
    const result = await readWorkerConfiguration(context, {
      expectedProjectRef: process.env.SIM_TRIGGER_ENV_SYNC_PROJECT_REF,
      region: process.env.SIM_TRIGGER_ENV_SYNC_REGION,
    })
    if (result.omitted.length)
      logger.warn('Managed variables absent from source are preserved; review retirement', {
        names: result.omitted,
      })
    logger.info('Worker configuration selected', { count: result.variables.length })
    return result.variables
  } catch (error) {
    logger.error('Worker configuration sync failed; deployment aborted', {
      category: error instanceof SyncFailure ? error.category : 'unexpected',
      names: error instanceof SyncFailure ? error.names : [],
    })
    process.exit(1)
  }
}
