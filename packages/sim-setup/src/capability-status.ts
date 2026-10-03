/**
 * Non-secret deployment-capability status derived from the same definitions the
 * application uses at runtime.
 *
 * @packageDocumentation
 */
import {
  ASYNC_JOBS_CAPABILITY,
  CACHE_CAPABILITY,
  EMAIL_CAPABILITY,
  type EnvCapabilityConfigurationError,
  type EnvCapabilityValues,
  getCapabilityConfigurationError,
  hasEnvCapabilityValue,
  inspectCapability,
  inspectOAuthClientCapability,
  isTruthyEnvCapabilityValue,
  KNOWLEDGE_EMBEDDINGS_CAPABILITY,
  LLM_KEY_POOLS,
  OAUTH_CLIENT_CAPABILITIES,
  type OAuthClientCapabilityId,
  OCR_CAPABILITY,
  type ProviderConfigurationState,
  type ProviderInspection,
  SANDBOX_CAPABILITY,
  STORAGE_CAPABILITY,
} from '@sim/deployment-config/env-capabilities'
import { SETUP_FEATURES, type SetupFeatureId } from './capability-config'

export type SetupStatusFeatureId = Exclude<SetupFeatureId, 'chat' | 'integration'>
export type CapabilityStatusState = 'default' | 'configured' | 'missing' | 'partial' | 'invalid'

export interface CapabilityStatusIssue {
  state: Extract<CapabilityStatusState, 'missing' | 'partial' | 'invalid'>
  message: string
}

interface FeatureStatusBase<TId extends SetupStatusFeatureId> {
  id: TId
  label: string
  setupCommand: `npx sim-setup add ${TId}`
  state: CapabilityStatusState
  issue?: CapabilityStatusIssue
}

type EmailProviderId = (typeof EMAIL_CAPABILITY.providers)[number]['id']
type KnowledgeEmbeddingsProviderId =
  (typeof KNOWLEDGE_EMBEDDINGS_CAPABILITY.providers)[number]['id']
type StorageProviderId =
  | (typeof STORAGE_CAPABILITY)['defaultProvider']['id']
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
  defaultProviderId: (typeof STORAGE_CAPABILITY)['defaultProvider']['id']
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

export interface KnowledgeEmbeddingsCapabilityStatus
  extends FeatureStatusBase<'knowledge-embeddings'> {
  strategy: 'fallback'
  providerIds: readonly KnowledgeEmbeddingsProviderId[]
  providers: readonly ProviderInspection<KnowledgeEmbeddingsProviderId>[]
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
  'knowledge-embeddings': KnowledgeEmbeddingsCapabilityStatus
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

function featureMetadata<TId extends SetupStatusFeatureId>(id: TId) {
  const definition = SETUP_FEATURES.find((feature) => feature.id === id)
  if (!definition) throw new Error(`Missing setup feature definition for ${id}`)
  return {
    id,
    label: definition.label,
    setupCommand: `npx sim-setup add ${id}` as const,
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
  const inspection = inspectCapability(EMAIL_CAPABILITY, values)
  const brokenState = brokenProviderState(inspection.providers)
  const state = inspection.configured ? 'configured' : (brokenState ?? 'missing')
  const configurationError =
    inspection.error ?? getCapabilityConfigurationError(EMAIL_CAPABILITY, inspection.providers)

  return {
    ...featureMetadata('email'),
    strategy: 'fallback',
    state,
    providerIds: inspection.providerIds,
    providers: inspection.providers,
    ...(configurationError ? { issue: issue(brokenState ?? 'invalid', configurationError) } : {}),
  }
}

function inspectStorage(values: EnvCapabilityValues): StorageCapabilityStatus {
  const inspection = inspectCapability(STORAGE_CAPABILITY, values)

  if (!inspection.error && inspection.providerId) {
    const providerId = inspection.providerId as StorageProviderId
    return {
      ...featureMetadata('storage'),
      strategy: 'selected',
      state: providerId === STORAGE_CAPABILITY.defaultProvider.id ? 'default' : 'configured',
      providerId,
      defaultProviderId: STORAGE_CAPABILITY.defaultProvider.id,
      providers: inspection.providers,
    }
  }

  const selectedId = readConfiguredString(values, STORAGE_CAPABILITY.selectorKey)
  const selected = inspection.providers.find((provider) => provider.id === selectedId)
  const state =
    selected && !selected.active
      ? 'missing'
      : selected?.state === 'partial'
        ? 'partial'
        : selected?.state === 'invalid'
          ? 'invalid'
          : (brokenProviderState(inspection.providers) ?? 'invalid')
  const error = inspection.error
  if (!error) throw new Error('Storage resolution failed without a configuration error')
  const providerId: StorageProviderId | null =
    selectedId === STORAGE_CAPABILITY.defaultProvider.id
      ? STORAGE_CAPABILITY.defaultProvider.id
      : (selected?.id ?? null)
  const safeMessage =
    selectedId && !providerId
      ? `Unknown ${STORAGE_CAPABILITY.selectorKey}. Expected one of: ${[
          STORAGE_CAPABILITY.defaultProvider.id,
          ...STORAGE_CAPABILITY.providers.map((provider) => provider.id),
        ].join(', ')}`
      : error.message

  return {
    ...featureMetadata('storage'),
    strategy: 'selected',
    state,
    providerId,
    defaultProviderId: STORAGE_CAPABILITY.defaultProvider.id,
    providers: inspection.providers,
    issue: issue(state, error, safeMessage),
  }
}

function inspectSandbox(values: EnvCapabilityValues): SandboxCapabilityStatus {
  const inspection = inspectCapability(SANDBOX_CAPABILITY, values)
  const requestedProvider =
    readConfiguredString(values, SANDBOX_CAPABILITY.selectorKey) ??
    SANDBOX_CAPABILITY.defaultProvider.id
  const providerId =
    inspection.providerId === 'e2b' && !isTruthyEnvCapabilityValue(values, 'E2B_ENABLED')
      ? 'disabled'
      : inspection.providerId

  if (!inspection.error) {
    const coherenceProblems: string[] = []
    if (
      isTruthyEnvCapabilityValue(values, 'E2B_ENABLED') !==
      isTruthyEnvCapabilityValue(values, 'NEXT_PUBLIC_E2B_ENABLED')
    ) {
      coherenceProblems.push('E2B_ENABLED and NEXT_PUBLIC_E2B_ENABLED disagree')
    }
    const remoteAvailable = providerId !== null && providerId !== 'disabled'
    if (remoteAvailable !== isTruthyEnvCapabilityValue(values, 'NEXT_PUBLIC_SANDBOXES_ENABLED')) {
      coherenceProblems.push(
        'remote sandbox availability and NEXT_PUBLIC_SANDBOXES_ENABLED disagree'
      )
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

  const knownProvider = requestedProvider === 'e2b' || requestedProvider === 'daytona'
  const selectedProvider = inspection.providers.find(
    (provider) => provider.id === requestedProvider
  )
  const state = !knownProvider || selectedProvider?.state === 'invalid' ? 'invalid' : 'missing'

  return {
    ...featureMetadata('sandbox'),
    state,
    providerId: knownProvider ? requestedProvider : null,
    issue: issue(
      state,
      inspection.error,
      knownProvider
        ? inspection.error.message
        : 'Unknown SANDBOX_PROVIDER. Expected one of: e2b, daytona'
    ),
  }
}

function inspectJobs(values: EnvCapabilityValues): JobsCapabilityStatus {
  const inspection = inspectCapability(ASYNC_JOBS_CAPABILITY, values)
  if (!inspection.error && inspection.providerId) {
    return {
      ...featureMetadata('jobs'),
      state: inspection.providerId === 'database' ? 'default' : 'configured',
      providerId: inspection.providerId,
    }
  }

  if (!inspection.error) {
    throw new Error('Async jobs inspection failed without a configuration error')
  }
  const configuredFieldCount = ['TRIGGER_SECRET_KEY', 'TRIGGER_PROJECT_ID'].filter((key) =>
    hasEnvCapabilityValue(values, key)
  ).length
  const state = configuredFieldCount === 0 ? 'missing' : 'partial'
  return {
    ...featureMetadata('jobs'),
    state,
    providerId: 'trigger-dev',
    issue: issue(state, inspection.error),
  }
}

function inspectCache(values: EnvCapabilityValues): CacheCapabilityStatus {
  const inspection = inspectCapability(CACHE_CAPABILITY, values)
  if (!inspection.error && inspection.providerId) {
    return {
      ...featureMetadata('cache'),
      state: inspection.providerId === 'database' ? 'default' : 'configured',
      providerId: inspection.providerId,
    }
  }

  if (!inspection.error) {
    throw new Error('Cache inspection failed without a configuration error')
  }
  const redis = inspection.providers.find((provider) => provider.id === 'redis')
  const state: CapabilityStatusIssue['state'] = redis?.state === 'invalid' ? 'invalid' : 'partial'
  return {
    ...featureMetadata('cache'),
    state,
    providerId: 'redis',
    issue: issue(state, inspection.error),
  }
}

function inspectKnowledge(values: EnvCapabilityValues): KnowledgeCapabilityStatus {
  const inspection = inspectCapability(OCR_CAPABILITY, values)
  if (!inspection.error && inspection.providerId) {
    return {
      ...featureMetadata('knowledge'),
      state: inspection.providerId === 'local' ? 'default' : 'configured',
      providerId: inspection.providerId,
    }
  }

  if (!inspection.error) {
    throw new Error('OCR inspection failed without a configuration error')
  }
  const selected = readConfiguredString(values, OCR_CAPABILITY.selectorKey)
  const azureFields = ['OCR_AZURE_API_KEY', 'OCR_AZURE_ENDPOINT', 'OCR_AZURE_MODEL_NAME'] as const
  const azureFieldCount = azureFields.filter((key) => hasEnvCapabilityValue(values, key)).length
  const knownProvider =
    selected === null ||
    selected === 'local' ||
    selected === 'mistral' ||
    selected === 'azure-mistral'
  const resolvedProvider = inspection.providerId
  const selectedInspection = inspection.providers.find(
    (provider) => provider.id === resolvedProvider
  )
  const state =
    !knownProvider || selectedInspection?.state === 'invalid'
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
        : selected === null
          ? resolvedProvider
          : null,
    issue: issue(
      state,
      inspection.error,
      knownProvider
        ? inspection.error.message
        : 'Unknown OCR_PROVIDER. Expected one of: local, mistral, azure-mistral'
    ),
  }
}

function inspectKnowledgeEmbeddings(
  values: EnvCapabilityValues
): KnowledgeEmbeddingsCapabilityStatus {
  const inspection = inspectCapability(KNOWLEDGE_EMBEDDINGS_CAPABILITY, values)
  const brokenState = brokenProviderState(inspection.providers)
  const state = inspection.configured ? 'configured' : (brokenState ?? 'missing')
  const configurationError =
    inspection.error ??
    getCapabilityConfigurationError(KNOWLEDGE_EMBEDDINGS_CAPABILITY, inspection.providers)

  return {
    ...featureMetadata('knowledge-embeddings'),
    strategy: 'fallback',
    state,
    providerIds: inspection.providerIds,
    providers: inspection.providers,
    ...(configurationError ? { issue: issue(brokenState ?? 'invalid', configurationError) } : {}),
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
  'knowledge-embeddings': inspectKnowledgeEmbeddings,
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
      'knowledge-embeddings': FEATURE_STATUS_BUILDERS['knowledge-embeddings'](values),
      llm: FEATURE_STATUS_BUILDERS.llm(values),
    },
    oauthClients: inspectOAuthClients(values),
  }
}
