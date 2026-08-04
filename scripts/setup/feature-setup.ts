import {
  ASYNC_JOBS_CAPABILITY,
  CACHE_CAPABILITY,
  getOAuthClientCapabilityFields,
  inspectCapability,
  isTruthyEnvCapabilityValue,
  LLM_KEY_POOLS,
  OAUTH_CLIENT_CAPABILITIES,
  OCR_CAPABILITY,
  resolveOAuthClientCapabilityId,
  SANDBOX_CAPABILITY,
  SETUP_FEATURES,
  type SetupFeatureId,
  validateCapabilityFieldInput,
} from '../../apps/sim/lib/core/config/env-capabilities.ts'
import { type ConfigurationSource, discoverConfigurationSources } from './configuration-sources.ts'
import { type EnvTarget, reconcileEnvValues } from './env-files.ts'
import * as p from './prompter.ts'
import { promptEmail, promptStorage } from './steps.ts'
import { theme } from './theme.ts'

function isSetupFeatureId(value: string): value is SetupFeatureId {
  return SETUP_FEATURES.some((feature) => feature.id === value)
}

function required(message: string, initialValue?: string): Promise<string> {
  return p.text({ message, initialValue, validate: (value) => (value ? undefined : 'required') })
}

async function promptSecret(message: string): Promise<string> {
  return p.password({ message, validate: (value) => (value ? undefined : 'required') })
}

export function validateDaytonaSnapshotInput(value: string): string | undefined {
  return validateCapabilityFieldInput(SANDBOX_CAPABILITY, 'DAYTONA_SHELL_SNAPSHOT_ID', value)
}

type SandboxSetupSelection =
  | { provider: 'disabled' }
  | { provider: 'e2b'; apiKey: string }
  | { provider: 'daytona'; apiKey: string; shellSnapshotId: string }

export interface SandboxSetupResult {
  remove: readonly string[]
  values: Record<string, string>
}

/** Builds the complete server/browser sandbox transition for one selected provider. */
export function reconcileSandboxSetup(selection: SandboxSetupSelection): SandboxSetupResult {
  if (selection.provider === 'disabled') {
    return {
      remove: ['SANDBOX_PROVIDER', 'E2B_API_KEY', 'DAYTONA_API_KEY', 'DAYTONA_SHELL_SNAPSHOT_ID'],
      values: {
        E2B_ENABLED: 'false',
        NEXT_PUBLIC_E2B_ENABLED: 'false',
        NEXT_PUBLIC_SANDBOX_ENABLED: 'false',
      },
    }
  }
  if (selection.provider === 'daytona') {
    return {
      remove: ['E2B_API_KEY'],
      values: {
        SANDBOX_PROVIDER: 'daytona',
        DAYTONA_API_KEY: selection.apiKey,
        DAYTONA_SHELL_SNAPSHOT_ID: selection.shellSnapshotId,
        E2B_ENABLED: 'false',
        NEXT_PUBLIC_E2B_ENABLED: 'false',
        NEXT_PUBLIC_SANDBOX_ENABLED: 'true',
      },
    }
  }
  return {
    remove: ['DAYTONA_API_KEY', 'DAYTONA_SHELL_SNAPSHOT_ID'],
    values: {
      SANDBOX_PROVIDER: 'e2b',
      E2B_ENABLED: 'true',
      E2B_API_KEY: selection.apiKey,
      NEXT_PUBLIC_E2B_ENABLED: 'true',
      NEXT_PUBLIC_SANDBOX_ENABLED: 'true',
    },
  }
}

async function setupIntegration(
  requestedId: string | undefined,
  vars: Map<string, string>
): Promise<Record<string, string>> {
  if (!requestedId) {
    throw new Error('Missing integration id. Example: bun run setup integration slack')
  }
  const providerId = resolveOAuthClientCapabilityId(requestedId)
  const fields = getOAuthClientCapabilityFields(requestedId)
  if (!providerId || !fields) {
    throw new Error(
      `Unknown OAuth integration "${requestedId}". Expected one of: ${Object.keys(OAUTH_CLIENT_CAPABILITIES).join(', ')}`
    )
  }

  const values: Record<string, string> = {}
  for (const key of fields) {
    const secret = key.includes('SECRET') || key.endsWith('_API_KEY')
    values[key] = secret ? await promptSecret(key) : await required(key, vars.get(key))
  }
  p.log.info(`Configured the ${providerId} OAuth client.`)
  return values
}

async function setupSandbox(vars: Map<string, string>): Promise<SandboxSetupResult> {
  const selectedProvider = inspectCapability(SANDBOX_CAPABILITY, vars).providerId
  const provider = await p.select<'daytona' | 'disabled' | 'e2b'>({
    message: 'Remote sandbox provider?',
    options: [
      { value: 'disabled', label: 'Disabled', hint: 'local JavaScript execution only' },
      { value: 'e2b', label: 'E2B', hint: 'remote code interpreter sandboxes' },
      { value: 'daytona', label: 'Daytona', hint: 'remote Daytona sandboxes' },
    ],
    initialValue:
      selectedProvider === 'daytona'
        ? 'daytona'
        : selectedProvider === 'e2b' && isTruthyEnvCapabilityValue(vars, 'E2B_ENABLED')
          ? 'e2b'
          : 'disabled',
  })
  if (provider === 'disabled') {
    return reconcileSandboxSetup({ provider })
  }
  if (provider === 'daytona') {
    return reconcileSandboxSetup({
      provider,
      apiKey: await promptSecret('DAYTONA_API_KEY'),
      shellSnapshotId: await p.text({
        message: 'DAYTONA_SHELL_SNAPSHOT_ID',
        initialValue: vars.get('DAYTONA_SHELL_SNAPSHOT_ID'),
        validate: validateDaytonaSnapshotInput,
      }),
    })
  }
  return reconcileSandboxSetup({ provider, apiKey: await promptSecret('E2B_API_KEY') })
}

async function setupJobs(vars: Map<string, string>): Promise<Record<string, string>> {
  const selectedProvider = inspectCapability(ASYNC_JOBS_CAPABILITY, vars).providerId
  const provider = await p.select({
    message: 'Async job provider?',
    options: [
      { value: 'database', label: 'Database queue', hint: 'built-in default' },
      { value: 'trigger', label: 'Trigger.dev', hint: 'external background jobs' },
    ],
    initialValue: selectedProvider === 'trigger-dev' ? 'trigger' : 'database',
  })
  if (provider === 'database') return { TRIGGER_DEV_ENABLED: 'false' }
  return {
    TRIGGER_DEV_ENABLED: 'true',
    TRIGGER_PROJECT_ID: await required('TRIGGER_PROJECT_ID', vars.get('TRIGGER_PROJECT_ID')),
    TRIGGER_SECRET_KEY: await promptSecret('TRIGGER_SECRET_KEY'),
  }
}

async function setupCache(vars: Map<string, string>): Promise<{
  remove: readonly string[]
  values: Record<string, string>
}> {
  const selectedProvider = inspectCapability(CACHE_CAPABILITY, vars).providerId
  const provider = await p.select({
    message: 'Cache and realtime coordination?',
    options: [
      { value: 'database', label: 'Postgres', hint: 'built-in default' },
      { value: 'redis', label: 'Redis', hint: 'recommended for multiple replicas' },
    ],
    initialValue: selectedProvider === 'redis' ? 'redis' : 'database',
  })
  if (provider === 'database') {
    return { remove: ['REDIS_URL', 'REDIS_TLS_SERVERNAME'], values: {} }
  }
  const redisUrl = await p.text({
    message: 'REDIS_URL',
    initialValue: vars.get('REDIS_URL') ?? 'redis://localhost:6379',
    validate: (value) => validateCapabilityFieldInput(CACHE_CAPABILITY, 'REDIS_URL', value),
  })
  const valuesWithoutServerName = new Map(vars)
  valuesWithoutServerName.set('REDIS_URL', redisUrl)
  valuesWithoutServerName.delete('REDIS_TLS_SERVERNAME')
  const redisInspection = inspectCapability(CACHE_CAPABILITY, valuesWithoutServerName)
  const needsServerName =
    redisInspection.providers
      .find((candidate) => candidate.id === 'redis')
      ?.missingFields.includes('REDIS_TLS_SERVERNAME') ?? false
  return {
    remove: needsServerName ? [] : ['REDIS_TLS_SERVERNAME'],
    values: {
      REDIS_URL: redisUrl,
      ...(needsServerName
        ? {
            REDIS_TLS_SERVERNAME: await required(
              'REDIS_TLS_SERVERNAME',
              vars.get('REDIS_TLS_SERVERNAME')
            ),
          }
        : {}),
    },
  }
}

async function setupKnowledge(vars: Map<string, string>): Promise<{
  remove: readonly string[]
  values: Record<string, string>
}> {
  const selectedProvider = inspectCapability(OCR_CAPABILITY, vars).providerId
  const provider = await p.select({
    message: 'PDF OCR provider?',
    options: [
      { value: 'local', label: 'Local parser', hint: 'built-in default' },
      { value: 'mistral', label: 'Mistral OCR', hint: 'Mistral API key' },
      { value: 'azure', label: 'Azure Mistral OCR', hint: 'Azure model deployment' },
    ],
    initialValue:
      selectedProvider === 'azure-mistral'
        ? 'azure'
        : selectedProvider === 'mistral'
          ? 'mistral'
          : 'local',
  })
  if (provider === 'local') {
    return {
      remove: ['OCR_AZURE_API_KEY', 'OCR_AZURE_ENDPOINT', 'OCR_AZURE_MODEL_NAME'],
      values: { OCR_PROVIDER: 'local' },
    }
  }
  if (provider === 'mistral') {
    return {
      remove: ['OCR_AZURE_API_KEY', 'OCR_AZURE_ENDPOINT', 'OCR_AZURE_MODEL_NAME'],
      values: {
        OCR_PROVIDER: 'mistral',
        MISTRAL_API_KEY: await promptSecret('MISTRAL_API_KEY'),
      },
    }
  }
  return {
    remove: [],
    values: {
      OCR_PROVIDER: 'azure-mistral',
      OCR_AZURE_ENDPOINT: await p.text({
        message: 'OCR_AZURE_ENDPOINT',
        initialValue: vars.get('OCR_AZURE_ENDPOINT'),
        validate: (value) =>
          validateCapabilityFieldInput(OCR_CAPABILITY, 'OCR_AZURE_ENDPOINT', value),
      }),
      OCR_AZURE_MODEL_NAME: await required(
        'OCR_AZURE_MODEL_NAME',
        vars.get('OCR_AZURE_MODEL_NAME')
      ),
      OCR_AZURE_API_KEY: await promptSecret('OCR_AZURE_API_KEY'),
    },
  }
}

type LlmKeyPoolId = keyof typeof LLM_KEY_POOLS

export interface LlmSetupResult {
  remove: readonly string[]
  values: Record<string, string>
}

/** Reconciles every rotation and legacy fallback key owned by the selected pool. */
export function reconcileLlmSetup(
  providerId: LlmKeyPoolId,
  values: Record<string, string>
): LlmSetupResult {
  const pool = LLM_KEY_POOLS[providerId]
  const fields = [...pool.keys, ...('fallbackKey' in pool ? [pool.fallbackKey] : [])]
  return {
    values,
    remove: fields.filter((key) => !Object.hasOwn(values, key)),
  }
}

async function setupLlm(): Promise<LlmSetupResult> {
  const provider = await p.select<LlmKeyPoolId>({
    message: 'LLM key pool?',
    options: Object.keys(LLM_KEY_POOLS).map((id) => ({ value: id, label: id })),
  })
  const keys = LLM_KEY_POOLS[provider].keys
  const values: Record<string, string> = {}
  for (const [index, key] of keys.entries()) {
    const value = await p.password({
      message: `${key}${index === 0 ? '' : ' (empty to finish)'}`,
      validate: index === 0 ? (candidate) => (candidate ? undefined : 'required') : undefined,
    })
    if (!value) break
    values[key] = value
  }
  return reconcileLlmSetup(provider, values)
}

export function setupFeatureUsage(): string {
  return SETUP_FEATURES.map((feature) =>
    feature.id === 'integration' ? 'integration <slug>' : feature.id
  ).join(' | ')
}

export interface FeatureSetupDestination {
  source: ConfigurationSource
  target: Extract<EnvTarget, 'sim' | 'root'>
  vars: Map<string, string>
  containerized: boolean
}

/** Resolves the one effective configuration this checkout can safely update. */
export function resolveFeatureSetupDestination(
  sources: readonly ConfigurationSource[]
): FeatureSetupDestination {
  if (sources.length === 0) {
    throw new Error('No Sim configuration was detected. Run bun run setup first.')
  }

  const managed = sources.filter((source) => source.managedByCurrentCheckout)
  if (managed.length === 0) {
    throw new Error(
      'No effective configuration is safely writable by this checkout. Process overrides, higher-precedence development env files, external Compose projects, and Helm releases must be updated at their source. Run bun run setup status for the detected sources.'
    )
  }
  if (managed.length > 1) {
    throw new Error(
      `More than one effective configuration is writable by this checkout (${managed.map((source) => source.label).join(', ')}). Run bun run setup status and remove the ambiguity before configuring a feature.`
    )
  }

  const source = managed[0]
  if (!source.values) {
    throw new Error(
      `${source.label} is managed by this checkout, but its effective environment could not be resolved. Run bun run setup status and fix the reported source error first.`
    )
  }
  if (source.kind === 'helm') {
    throw new Error(
      'Helm configuration cannot be updated by bun run setup. Update the release Secret or values and upgrade the release.'
    )
  }

  return {
    source,
    target: source.kind === 'compose' ? 'root' : 'sim',
    vars: source.values,
    containerized: source.kind === 'compose',
  }
}

export async function runFeatureSetup(feature: string, args: readonly string[]): Promise<void> {
  if (!isSetupFeatureId(feature)) {
    throw new Error(`Unknown setup feature "${feature}". Expected: ${setupFeatureUsage()}`)
  }
  const destination = resolveFeatureSetupDestination(discoverConfigurationSources())
  const { target, vars } = destination
  let values: Record<string, string>
  let remove: readonly string[] = []

  if (feature === 'email') {
    const result = await promptEmail(vars)
    values = result.values
    remove = result.remove
  } else if (feature === 'storage') {
    const result = await promptStorage(vars, destination.containerized)
    values = result.values
    remove = result.remove
  } else if (feature === 'sandbox') {
    const result = await setupSandbox(vars)
    values = result.values
    remove = result.remove
  } else if (feature === 'jobs') values = await setupJobs(vars)
  else if (feature === 'integration') values = await setupIntegration(args[0], vars)
  else if (feature === 'llm') {
    const result = await setupLlm()
    values = result.values
    remove = result.remove
  } else if (feature === 'cache') {
    const result = await setupCache(vars)
    values = result.values
    remove = result.remove
  } else if (feature === 'knowledge') {
    const result = await setupKnowledge(vars)
    values = result.values
    remove = result.remove
  } else {
    const unhandledFeature: never = feature
    throw new Error(`Setup feature ${unhandledFeature} has no handler`)
  }

  reconcileEnvValues(target, remove, values)
  const label = SETUP_FEATURES.find((item) => item.id === feature)?.label
  p.outro(
    theme.accent(
      destination.containerized
        ? `${label} written to .env. Recreate the app container for it to take effect.`
        : `${label} configured.`
    )
  )
}
