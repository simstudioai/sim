/**
 * Non-secret deployment-capability status derived from the same definitions the
 * application uses at runtime.
 *
 * @packageDocumentation
 */
import {
  EMAIL_CAPABILITY,
  EnvCapabilityConfigurationError,
  type EnvCapabilityValues,
  hasEnvCapabilityValue,
  inspectOAuthClientCapability,
  inspectProvider,
  isTruthyEnvCapabilityValue,
  isValidEnvCapabilityFieldValue,
  LLM_KEY_POOLS,
  OAUTH_CLIENT_CAPABILITIES,
  type OAuthClientCapabilityId,
  type ProviderConfigurationState,
  type ProviderInspection,
  resolveAsyncJobsProvider,
  resolveCacheProvider,
  resolveFallbackCapability,
  resolveOcrProvider,
  resolveSandboxProviderId,
  resolveSelectedCapability,
  SETUP_FEATURES,
  type SetupFeatureId,
  STORAGE_CAPABILITY,
} from '@/lib/core/config/env-capabilities'

export type SetupStatusFeatureId = Exclude<SetupFeatureId, 'integration'>
export type CapabilityStatusState = 'default' | 'configured' | 'missing' | 'partial' | 'invalid'

export interface CapabilityStatusIssue {
  state: Extract<CapabilityStatusState, 'missing' | 'partial' | 'invalid'>
  message: string
}

interface FeatureStatusBase<TId extends SetupStatusFeatureId> {
  id: TId
  label: string
  setupCommand: `bun run setup ${TId}`
  state: CapabilityStatusState
  issue?: CapabilityStatusIssue
}

type EmailProviderId = (typeof EMAIL_CAPABILITY.providers)[number]['id']
type StorageProviderId =
  | (typeof STORAGE_CAPABILITY)['defaultProvider']
  | (typeof STORAGE_CAPABILITY.providers)[number]['id']
type LlmKeyPoolId = keyof typeof LLM_KEY_POOLS

export interface EmailCapabilityStatus extends FeatureStatusBase<'email'> {
  strategy: 'fallback'
  providerIds: readonly EmailProviderId[]
  providers: readonly ProviderInspection<EmailProviderId>[]
}

export interface StorageCapabilityStatus extends FeatureStatusBase<'storage'> {
  strategy: 'selected'
  providerId: StorageProviderId | null
  defaultProviderId: (typeof STORAGE_CAPABILITY)['defaultProvider']
  providers: readonly ProviderInspection<(typeof STORAGE_CAPABILITY.providers)[number]['id']>[]
}

export interface SandboxCapabilityStatus extends FeatureStatusBase<'sandbox'> {
  providerId: 'disabled' | 'e2b' | 'daytona' | null
}

export interface JobsCapabilityStatus extends FeatureStatusBase<'jobs'> {
  providerId: 'database' | 'trigger-dev'
}

export interface CacheCapabilityStatus extends FeatureStatusBase<'cache'> {
  providerId: 'database' | 'redis'
}

export interface KnowledgeCapabilityStatus extends FeatureStatusBase<'knowledge'> {
  providerId: 'local' | 'mistral' | 'azure-mistral' | null
}

export interface LlmKeyPoolStatus {
  id: LlmKeyPoolId
  state: 'configured' | 'missing'
  configuredKeyCount: number
  effectiveKeyCount: number
  fallbackKeyConfigured: boolean
}

export interface LlmCapabilityStatus extends FeatureStatusBase<'llm'> {
  pools: Readonly<Record<LlmKeyPoolId, LlmKeyPoolStatus>>
  configuredPoolCount: number
  configuredKeyCount: number
  effectiveKeyCount: number
}

interface FeatureStatusById {
  email: EmailCapabilityStatus
  storage: StorageCapabilityStatus
  sandbox: SandboxCapabilityStatus
  jobs: JobsCapabilityStatus
  cache: CacheCapabilityStatus
  knowledge: KnowledgeCapabilityStatus
  llm: LlmCapabilityStatus
}

export type EnvCapabilityFeatureStatuses = Pick<FeatureStatusById, SetupStatusFeatureId>

export interface OAuthClientStatus {
  id: OAuthClientCapabilityId
  state: ProviderConfigurationState
  configuredFieldCount: number
  requiredFieldCount: number
  missingFields: readonly string[]
  setupCommand: string
}

export interface OAuthClientStatuses {
  clients: Readonly<Record<OAuthClientCapabilityId, OAuthClientStatus>>
  readyCount: number
  partialCount: number
  absentCount: number
  invalidCount: number
}

export interface EnvCapabilityStatusSnapshot {
  features: EnvCapabilityFeatureStatuses
  oauthClients: OAuthClientStatuses
}

interface CapturedResolution<T> {
  value?: T
  error?: EnvCapabilityConfigurationError
}

function captureConfigurationError<T>(
  capabilityId: string,
  resolve: () => T
): CapturedResolution<T> {
  try {
    return { value: resolve() }
  } catch (error) {
    if (!(error instanceof EnvCapabilityConfigurationError)) throw error
    if (error.capabilityId !== capabilityId) throw error
    return { error }
  }
}

function featureMetadata<TId extends SetupStatusFeatureId>(id: TId) {
  const definition = SETUP_FEATURES.find((feature) => feature.id === id)
  if (!definition) throw new Error(`Missing setup feature definition for ${id}`)
  return {
    id,
    label: definition.label,
    setupCommand: `bun run setup ${id}` as const,
  }
}

function readConfiguredString(values: EnvCapabilityValues, key: string): string | null {
  if (!hasEnvCapabilityValue(values, key)) return null
  const value =
    values instanceof Map ? values.get(key) : (values as Readonly<Record<string, unknown>>)[key]
  return String(value).trim().toLowerCase()
}

function issue(
  state: CapabilityStatusIssue['state'],
  error: EnvCapabilityConfigurationError,
  safeMessage = error.message
): CapabilityStatusIssue {
  return { state, message: safeMessage }
}

function brokenProviderState(
  providers: readonly ProviderInspection[]
): Extract<CapabilityStatusState, 'partial' | 'invalid'> | null {
  if (providers.some((provider) => provider.state === 'invalid')) return 'invalid'
  if (providers.some((provider) => provider.state === 'partial')) return 'partial'
  return null
}

function inspectEmail(values: EnvCapabilityValues): EmailCapabilityStatus {
  const providers = EMAIL_CAPABILITY.providers.map((provider) => inspectProvider(provider, values))
  const resolution = captureConfigurationError('email', () =>
    resolveFallbackCapability(EMAIL_CAPABILITY, values)
  )
  const providerIds = providers
    .filter((provider) => provider.state === 'ready')
    .map((provider) => provider.id)
  const brokenState = brokenProviderState(providers)
  const state = brokenState ?? (providerIds.length > 0 ? 'configured' : 'missing')

  return {
    ...featureMetadata('email'),
    strategy: 'fallback',
    state,
    providerIds,
    providers,
    ...(resolution.error ? { issue: issue(brokenState ?? 'invalid', resolution.error) } : {}),
  }
}

function inspectStorage(values: EnvCapabilityValues): StorageCapabilityStatus {
  const providers = STORAGE_CAPABILITY.providers.map((provider) =>
    inspectProvider(provider, values)
  )
  const resolution = captureConfigurationError('storage', () =>
    resolveSelectedCapability(STORAGE_CAPABILITY, values)
  )

  if (resolution.value) {
    const providerId = resolution.value.providerId as StorageProviderId
    return {
      ...featureMetadata('storage'),
      strategy: 'selected',
      state: providerId === STORAGE_CAPABILITY.defaultProvider ? 'default' : 'configured',
      providerId,
      defaultProviderId: STORAGE_CAPABILITY.defaultProvider,
      providers,
    }
  }

  const selectedId = readConfiguredString(values, STORAGE_CAPABILITY.selectorKey)
  const selected = providers.find((provider) => provider.id === selectedId)
  const state =
    selected?.state === 'absent'
      ? 'missing'
      : selected?.state === 'partial'
        ? 'partial'
        : selected?.state === 'invalid'
          ? 'invalid'
          : (brokenProviderState(providers) ?? 'invalid')
  const error = resolution.error
  if (!error) throw new Error('Storage resolution failed without a configuration error')
  const providerId: StorageProviderId | null =
    selectedId === STORAGE_CAPABILITY.defaultProvider
      ? STORAGE_CAPABILITY.defaultProvider
      : (selected?.id ?? null)
  const safeMessage =
    selectedId && !providerId
      ? `Unknown ${STORAGE_CAPABILITY.selectorKey}. Expected one of: ${[
          STORAGE_CAPABILITY.defaultProvider,
          ...STORAGE_CAPABILITY.providers.map((provider) => provider.id),
        ].join(', ')}`
      : error.message

  return {
    ...featureMetadata('storage'),
    strategy: 'selected',
    state,
    providerId,
    defaultProviderId: STORAGE_CAPABILITY.defaultProvider,
    providers,
    issue: issue(state, error, safeMessage),
  }
}

function inspectSandbox(values: EnvCapabilityValues): SandboxCapabilityStatus {
  const resolution = captureConfigurationError('sandbox', () => resolveSandboxProviderId(values))
  const requestedProvider = readConfiguredString(values, 'SANDBOX_PROVIDER') ?? 'e2b'

  if (resolution.value) {
    const providerId =
      resolution.value === 'e2b' && !isTruthyEnvCapabilityValue(values, 'E2B_ENABLED')
        ? 'disabled'
        : resolution.value
    const coherenceProblems: string[] = []
    if (
      isTruthyEnvCapabilityValue(values, 'E2B_ENABLED') !==
      isTruthyEnvCapabilityValue(values, 'NEXT_PUBLIC_E2B_ENABLED')
    ) {
      coherenceProblems.push('E2B_ENABLED and NEXT_PUBLIC_E2B_ENABLED disagree')
    }
    const remoteAvailable = providerId !== 'disabled'
    if (remoteAvailable !== isTruthyEnvCapabilityValue(values, 'NEXT_PUBLIC_SANDBOX_ENABLED')) {
      coherenceProblems.push('remote sandbox availability and NEXT_PUBLIC_SANDBOX_ENABLED disagree')
    }
    if (coherenceProblems.length > 0) {
      return {
        ...featureMetadata('sandbox'),
        state: 'partial',
        providerId,
        issue: {
          state: 'partial',
          message: `${coherenceProblems.join('; ')}. Server and browser configuration must match.`,
        },
      }
    }
    return {
      ...featureMetadata('sandbox'),
      state: providerId === 'disabled' ? 'default' : 'configured',
      providerId,
    }
  }

  const error = resolution.error
  if (!error) throw new Error('Sandbox resolution failed without a configuration error')
  const knownProvider = requestedProvider === 'e2b' || requestedProvider === 'daytona'
  const daytonaSnapshot =
    requestedProvider === 'daytona'
      ? readConfiguredString(values, 'DAYTONA_SHELL_SNAPSHOT_ID')
      : null
  const invalidDaytonaSnapshot =
    daytonaSnapshot !== null && !isValidEnvCapabilityFieldValue('daytona-snapshot', daytonaSnapshot)
  const state = !knownProvider || invalidDaytonaSnapshot ? 'invalid' : 'missing'

  return {
    ...featureMetadata('sandbox'),
    state,
    providerId: knownProvider ? requestedProvider : null,
    issue: issue(
      state,
      error,
      knownProvider ? error.message : 'Unknown SANDBOX_PROVIDER. Expected one of: e2b, daytona'
    ),
  }
}

function inspectJobs(values: EnvCapabilityValues): JobsCapabilityStatus {
  const resolution = captureConfigurationError('jobs', () => resolveAsyncJobsProvider(values))
  if (resolution.value) {
    return {
      ...featureMetadata('jobs'),
      state: resolution.value === 'database' ? 'default' : 'configured',
      providerId: resolution.value,
    }
  }

  const error = resolution.error
  if (!error) throw new Error('Async jobs resolution failed without a configuration error')
  const configuredFieldCount = ['TRIGGER_SECRET_KEY', 'TRIGGER_PROJECT_ID'].filter((key) =>
    hasEnvCapabilityValue(values, key)
  ).length
  const state = configuredFieldCount === 0 ? 'missing' : 'partial'
  return {
    ...featureMetadata('jobs'),
    state,
    providerId: 'trigger-dev',
    issue: issue(state, error),
  }
}

function inspectCache(values: EnvCapabilityValues): CacheCapabilityStatus {
  const resolution = captureConfigurationError('cache', () => resolveCacheProvider(values))
  if (resolution.value) {
    return {
      ...featureMetadata('cache'),
      state: resolution.value === 'database' ? 'default' : 'configured',
      providerId: resolution.value,
    }
  }

  const error = resolution.error
  if (!error) throw new Error('Cache resolution failed without a configuration error')
  let state: CapabilityStatusIssue['state'] = 'invalid'
  const redisUrl = readConfiguredString(values, 'REDIS_URL')
  if (redisUrl) {
    try {
      const parsed = new URL(redisUrl)
      if (
        parsed.protocol === 'rediss:' &&
        /^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname) &&
        !hasEnvCapabilityValue(values, 'REDIS_TLS_SERVERNAME')
      ) {
        state = 'partial'
      }
    } catch {
      state = 'invalid'
    }
  }
  return {
    ...featureMetadata('cache'),
    state,
    providerId: 'redis',
    issue: issue(state, error),
  }
}

function inspectKnowledge(values: EnvCapabilityValues): KnowledgeCapabilityStatus {
  const resolution = captureConfigurationError('knowledge', () => resolveOcrProvider(values))
  if (resolution.value) {
    return {
      ...featureMetadata('knowledge'),
      state: resolution.value === 'local' ? 'default' : 'configured',
      providerId: resolution.value,
    }
  }

  const error = resolution.error
  if (!error) throw new Error('OCR resolution failed without a configuration error')
  const selected = readConfiguredString(values, 'OCR_PROVIDER')
  const azureFields = ['OCR_AZURE_API_KEY', 'OCR_AZURE_ENDPOINT', 'OCR_AZURE_MODEL_NAME'] as const
  const azureFieldCount = azureFields.filter((key) => hasEnvCapabilityValue(values, key)).length
  const azureEndpoint = readConfiguredString(values, 'OCR_AZURE_ENDPOINT')
  const invalidAzureEndpoint =
    azureEndpoint !== null && !isValidEnvCapabilityFieldValue('http-url', azureEndpoint)
  const knownProvider =
    selected === null ||
    selected === 'local' ||
    selected === 'mistral' ||
    selected === 'azure-mistral'
  const state =
    !knownProvider || invalidAzureEndpoint
      ? 'invalid'
      : selected === 'mistral' || selected === 'azure-mistral'
        ? azureFieldCount === 0 && selected === 'azure-mistral'
          ? 'missing'
          : selected === 'mistral' && !hasEnvCapabilityValue(values, 'MISTRAL_API_KEY')
            ? 'missing'
            : 'partial'
        : 'partial'

  return {
    ...featureMetadata('knowledge'),
    state,
    providerId:
      selected === 'local' || selected === 'mistral' || selected === 'azure-mistral'
        ? selected
        : selected === null && azureFieldCount > 0
          ? 'azure-mistral'
          : null,
    issue: issue(
      state,
      error,
      knownProvider
        ? error.message
        : 'Unknown OCR_PROVIDER. Expected one of: local, mistral, azure-mistral'
    ),
  }
}

function inspectLlm(values: EnvCapabilityValues): LlmCapabilityStatus {
  const pools = {} as Record<LlmKeyPoolId, LlmKeyPoolStatus>
  let configuredPoolCount = 0
  let configuredKeyCount = 0
  let effectiveKeyCount = 0

  for (const id of Object.keys(LLM_KEY_POOLS) as LlmKeyPoolId[]) {
    const definition = LLM_KEY_POOLS[id]
    const rotationKeyCount = definition.keys.filter((key) =>
      hasEnvCapabilityValue(values, key)
    ).length
    const fallbackKeyConfigured =
      'fallbackKey' in definition && hasEnvCapabilityValue(values, definition.fallbackKey)
    const poolConfiguredKeyCount = rotationKeyCount + (fallbackKeyConfigured ? 1 : 0)
    const poolEffectiveKeyCount = rotationKeyCount || (fallbackKeyConfigured ? 1 : 0)
    const state = poolEffectiveKeyCount > 0 ? 'configured' : 'missing'
    if (state === 'configured') configuredPoolCount += 1
    configuredKeyCount += poolConfiguredKeyCount
    effectiveKeyCount += poolEffectiveKeyCount
    pools[id] = {
      id,
      state,
      configuredKeyCount: poolConfiguredKeyCount,
      effectiveKeyCount: poolEffectiveKeyCount,
      fallbackKeyConfigured,
    }
  }

  return {
    ...featureMetadata('llm'),
    state: configuredPoolCount > 0 ? 'configured' : 'missing',
    pools,
    configuredPoolCount,
    configuredKeyCount,
    effectiveKeyCount,
  }
}

function inspectOAuthClients(values: EnvCapabilityValues): OAuthClientStatuses {
  const clients = {} as Record<OAuthClientCapabilityId, OAuthClientStatus>
  let readyCount = 0
  let partialCount = 0
  let absentCount = 0
  let invalidCount = 0

  for (const id of Object.keys(OAUTH_CLIENT_CAPABILITIES) as OAuthClientCapabilityId[]) {
    const inspection = inspectOAuthClientCapability(id, values)
    if (inspection.state === 'ready') readyCount += 1
    else if (inspection.state === 'partial') partialCount += 1
    else if (inspection.state === 'absent') absentCount += 1
    else invalidCount += 1

    clients[id] = {
      id,
      state: inspection.state,
      configuredFieldCount: OAUTH_CLIENT_CAPABILITIES[id].length - inspection.missingFields.length,
      requiredFieldCount: OAUTH_CLIENT_CAPABILITIES[id].length,
      missingFields: inspection.missingFields,
      setupCommand: inspection.setupCommand,
    }
  }

  return { clients, readyCount, partialCount, absentCount, invalidCount }
}

const FEATURE_STATUS_BUILDERS = {
  email: inspectEmail,
  storage: inspectStorage,
  sandbox: inspectSandbox,
  jobs: inspectJobs,
  cache: inspectCache,
  knowledge: inspectKnowledge,
  llm: inspectLlm,
} satisfies Record<SetupStatusFeatureId, (values: EnvCapabilityValues) => unknown>

/** Builds a status snapshot without returning any configured secret values. */
export function buildEnvCapabilityStatus(values: EnvCapabilityValues): EnvCapabilityStatusSnapshot {
  return {
    features: {
      email: FEATURE_STATUS_BUILDERS.email(values),
      storage: FEATURE_STATUS_BUILDERS.storage(values),
      sandbox: FEATURE_STATUS_BUILDERS.sandbox(values),
      jobs: FEATURE_STATUS_BUILDERS.jobs(values),
      cache: FEATURE_STATUS_BUILDERS.cache(values),
      knowledge: FEATURE_STATUS_BUILDERS.knowledge(values),
      llm: FEATURE_STATUS_BUILDERS.llm(values),
    },
    oauthClients: inspectOAuthClients(values),
  }
}
