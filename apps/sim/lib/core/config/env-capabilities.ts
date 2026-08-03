/**
 * Canonical deployment-capability definitions shared by the Sim runtime and setup CLI.
 * Keep this module dependency-free so scripts can import the same provider requirements
 * the application enforces without creating a second configuration catalog.
 *
 * @packageDocumentation
 */
export type EnvCapabilityValue = string | number | boolean | null | undefined

export const CORE_CONFIGURATION_KEYS = [
  'DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'NEXT_PUBLIC_APP_URL',
  'ENCRYPTION_KEY',
  'INTERNAL_API_SECRET',
] as const

export type EnvCapabilityValues =
  | ReadonlyMap<string, EnvCapabilityValue>
  | Readonly<Record<string, EnvCapabilityValue>>

export interface EnvFieldRequirement {
  type: 'field'
  key: string
  format?: 'daytona-snapshot' | 'gmail-service-account' | 'http-url' | 'json' | 'port' | 'url'
}

export interface AllOfRequirement {
  type: 'allOf'
  requirements: readonly EnvRequirement[]
}

export interface AnyOfRequirement {
  type: 'anyOf'
  requirements: readonly EnvRequirement[]
}

export type EnvRequirement = EnvFieldRequirement | AllOfRequirement | AnyOfRequirement

export interface EnvProviderDefinition<TId extends string = string> {
  id: TId
  label: string
  activation: readonly string[]
  requires: EnvRequirement
  pairedFields?: readonly (readonly [string, string])[]
  optionalFields?: readonly EnvFieldRequirement[]
  setupFields: readonly string[]
}

export interface FallbackCapabilityDefinition<
  TId extends string = string,
  TProvider extends EnvProviderDefinition = EnvProviderDefinition,
> {
  strategy: 'fallback'
  id: TId
  label: string
  setupCommand: string
  providers: readonly TProvider[]
}

export interface SelectedCapabilityDefinition<
  TId extends string = string,
  TProvider extends EnvProviderDefinition = EnvProviderDefinition,
> {
  strategy: 'selected'
  id: TId
  label: string
  setupCommand: string
  selectorKey: string
  defaultProvider: string
  providers: readonly TProvider[]
}

export type ProviderId<TDefinition extends FallbackCapabilityDefinition> =
  TDefinition['providers'][number]['id']

export type FallbackFactories<TDefinition extends FallbackCapabilityDefinition, TProvider> = {
  [TId in ProviderId<TDefinition>]: () => TProvider | null
}

export type ProviderConfigurationState = 'absent' | 'partial' | 'ready' | 'invalid'

export interface ProviderInspection<TId extends string = string> {
  id: TId
  label: string
  state: ProviderConfigurationState
  missingFields: readonly string[]
  invalidFields: readonly string[]
}

export interface FallbackCapabilityResolution<TId extends string = string> {
  configured: boolean
  providerIds: readonly TId[]
  providers: readonly ProviderInspection<TId>[]
}

export interface SelectedCapabilityResolution<TId extends string = string> {
  providerId: TId | string
  providers: readonly ProviderInspection<TId>[]
}

export class EnvCapabilityConfigurationError extends Error {
  constructor(
    readonly capabilityId: string,
    message: string
  ) {
    super(message)
    this.name = 'EnvCapabilityConfigurationError'
  }
}

function readValue(values: EnvCapabilityValues, key: string): EnvCapabilityValue {
  if (values instanceof Map) return values.get(key)
  return (values as Readonly<Record<string, EnvCapabilityValue>>)[key]
}

function hasValue(values: EnvCapabilityValues, key: string): boolean {
  const value = readValue(values, key)
  if (value === undefined || value === null || value === false) return false
  if (typeof value !== 'string') return true
  const normalized = value.trim().toLowerCase()
  return normalized !== '' && normalized !== 'placeholder'
}

function isTruthyValue(values: EnvCapabilityValues, key: string): boolean {
  const value = readValue(values, key)
  if (value === true || value === 1) return true
  if (typeof value !== 'string') return false
  const normalized = value.toLowerCase()
  return normalized === 'true' || normalized === '1'
}

/** Returns whether an environment field contains a usable configuration value. */
export function hasEnvCapabilityValue(values: EnvCapabilityValues, key: string): boolean {
  return hasValue(values, key)
}

/** Resolves the boolean semantics shared by capability selectors and status reporting. */
export function isTruthyEnvCapabilityValue(values: EnvCapabilityValues, key: string): boolean {
  return isTruthyValue(values, key)
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

export function envField(
  key: string,
  options: Pick<EnvFieldRequirement, 'format'> = {}
): EnvFieldRequirement {
  return { type: 'field', key, ...options }
}

export function allOf(...requirements: readonly EnvRequirement[]): AllOfRequirement {
  return { type: 'allOf', requirements }
}

export function anyOf(...requirements: readonly EnvRequirement[]): AnyOfRequirement {
  return { type: 'anyOf', requirements }
}

function requirementKeys(requirement: EnvRequirement): string[] {
  return requirement.type === 'field'
    ? [requirement.key]
    : requirement.requirements.flatMap(requirementKeys)
}

function capabilityKeys(
  definition: FallbackCapabilityDefinition | SelectedCapabilityDefinition
): string[] {
  return [
    ...(definition.strategy === 'selected' ? [definition.selectorKey] : []),
    ...definition.providers.flatMap((provider) => [
      ...provider.activation,
      ...requirementKeys(provider.requires),
      ...(provider.pairedFields ?? []).flat(),
      ...(provider.optionalFields ?? []).map((field) => field.key),
      ...provider.setupFields,
    ]),
  ]
}

/** Returns every provider field owned by a capability's setup flow. */
export function getCapabilitySetupFields(
  definition: FallbackCapabilityDefinition | SelectedCapabilityDefinition
): readonly string[] {
  return unique(definition.providers.flatMap((provider) => provider.setupFields))
}

export function defineFallbackCapability<const TDefinition extends FallbackCapabilityDefinition>(
  definition: TDefinition
): TDefinition {
  return definition
}

export function defineSelectedCapability<const TDefinition extends SelectedCapabilityDefinition>(
  definition: TDefinition
): TDefinition {
  return definition
}

interface RequirementInspection {
  ready: boolean
  missingFields: readonly string[]
  invalidFields: readonly string[]
}

/** Applies the canonical field-format validation used by runtime capability resolution. */
export function isValidEnvCapabilityFieldValue(
  format: NonNullable<EnvFieldRequirement['format']>,
  value: EnvCapabilityValue
): boolean {
  const serialized = String(value)
  if (format === 'daytona-snapshot') {
    const match = /^([^:\s]+):([^:\s]+)$/.exec(serialized)
    if (!match) return false
    return !['latest', 'lts', 'stable'].includes(match[2].toLowerCase())
  }
  if (format === 'json' || format === 'gmail-service-account') {
    try {
      const parsed: unknown = JSON.parse(serialized)
      if (format === 'gmail-service-account') {
        return (
          typeof parsed === 'object' &&
          parsed !== null &&
          'client_email' in parsed &&
          typeof parsed.client_email === 'string' &&
          parsed.client_email.length > 0 &&
          'private_key' in parsed &&
          typeof parsed.private_key === 'string' &&
          parsed.private_key.length > 0
        )
      }
      return true
    } catch {
      return false
    }
  }
  if (format === 'port') {
    const port = Number(serialized)
    return Number.isInteger(port) && port >= 1 && port <= 65535
  }
  try {
    const parsed = new URL(serialized)
    return format !== 'http-url' || parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function inspectField(
  requirement: EnvFieldRequirement,
  values: EnvCapabilityValues
): RequirementInspection {
  if (!hasValue(values, requirement.key)) {
    return { ready: false, missingFields: [requirement.key], invalidFields: [] }
  }

  const value = readValue(values, requirement.key)
  const valid = requirement.format
    ? isValidEnvCapabilityFieldValue(requirement.format, value)
    : true

  return valid
    ? { ready: true, missingFields: [], invalidFields: [] }
    : { ready: false, missingFields: [], invalidFields: [requirement.key] }
}

function inspectRequirement(
  requirement: EnvRequirement,
  values: EnvCapabilityValues
): RequirementInspection {
  if (requirement.type === 'field') return inspectField(requirement, values)

  const inspections = requirement.requirements.map((child) => inspectRequirement(child, values))
  if (requirement.type === 'anyOf' && inspections.some((inspection) => inspection.ready)) {
    return { ready: true, missingFields: [], invalidFields: [] }
  }

  return {
    ready: inspections.every((inspection) => inspection.ready),
    missingFields: unique(inspections.flatMap((inspection) => inspection.missingFields)),
    invalidFields: unique(inspections.flatMap((inspection) => inspection.invalidFields)),
  }
}

function inspectProviderRequirements<const TProvider extends EnvProviderDefinition>(
  provider: TProvider,
  values: EnvCapabilityValues
): ProviderInspection<TProvider['id']> {
  const inspection = inspectRequirement(provider.requires, values)
  const invalidOptionalFields = (provider.optionalFields ?? []).flatMap((field) => {
    if (!hasValue(values, field.key)) return []
    return inspectField(field, values).invalidFields
  })
  const invalidPairs = (provider.pairedFields ?? []).flatMap(([left, right]) =>
    hasValue(values, left) === hasValue(values, right) ? [] : [left, right]
  )
  const invalidFields = unique([
    ...inspection.invalidFields,
    ...invalidOptionalFields,
    ...invalidPairs,
  ])
  return {
    id: provider.id,
    label: provider.label,
    state: invalidFields.length > 0 ? 'invalid' : inspection.ready ? 'ready' : 'partial',
    missingFields: inspection.missingFields,
    invalidFields,
  }
}

export function inspectProvider<const TProvider extends EnvProviderDefinition>(
  provider: TProvider,
  values: EnvCapabilityValues
): ProviderInspection<TProvider['id']> {
  const active = provider.activation.some((key) => hasValue(values, key))
  return active
    ? inspectProviderRequirements(provider, values)
    : {
        id: provider.id,
        label: provider.label,
        state: 'absent',
        missingFields: [],
        invalidFields: [],
      }
}

function providerProblems(inspection: ProviderInspection): string {
  return [
    inspection.missingFields.length > 0 ? `missing ${inspection.missingFields.join(', ')}` : null,
    inspection.invalidFields.length > 0 ? `invalid ${inspection.invalidFields.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('; ')
}

export function getCapabilityConfigurationError(
  definition: FallbackCapabilityDefinition | SelectedCapabilityDefinition,
  inspections: readonly ProviderInspection[]
): EnvCapabilityConfigurationError | null {
  const broken = inspections.filter(
    (inspection) => inspection.state === 'partial' || inspection.state === 'invalid'
  )
  if (broken.length === 0) return null

  const details = broken.map((inspection) => `${inspection.label}: ${providerProblems(inspection)}`)

  return new EnvCapabilityConfigurationError(
    definition.id,
    `${definition.label} is partially or incorrectly configured (${details.join(' | ')}). Run ${definition.setupCommand}.`
  )
}

export function resolveSelectedCapability<const TDefinition extends SelectedCapabilityDefinition>(
  definition: TDefinition,
  values: EnvCapabilityValues
): SelectedCapabilityResolution<TDefinition['providers'][number]['id']> {
  const rawSelector = readValue(values, definition.selectorKey)
  const selector = hasValue(values, definition.selectorKey)
    ? String(rawSelector).trim().toLowerCase()
    : null
  const providers = definition.providers.map((provider) =>
    provider.id === selector
      ? inspectProviderRequirements(provider, values)
      : inspectProvider(provider, values)
  )
  const known = new Set([
    definition.defaultProvider,
    ...definition.providers.map((provider) => provider.id),
  ])

  if (selector && !known.has(selector)) {
    throw new EnvCapabilityConfigurationError(
      definition.id,
      `Unknown ${definition.selectorKey} "${rawSelector}". Expected one of: ${[...known].join(', ')}`
    )
  }
  if (selector && selector !== definition.defaultProvider) {
    const selected = providers.find((provider) => provider.id === selector)
    if (selected?.state !== 'ready') {
      throw new EnvCapabilityConfigurationError(
        definition.id,
        `${definition.label} selects ${selector}, but that provider is not configured (${selected ? providerProblems(selected) : 'provider definition missing'}). Run ${definition.setupCommand}.`
      )
    }
    return { providerId: selector, providers }
  }
  if (selector === definition.defaultProvider) {
    return { providerId: definition.defaultProvider, providers }
  }

  const ready = providers.filter((provider) => provider.state === 'ready')
  if (ready.length > 0) return { providerId: ready[0].id, providers }

  const error = getCapabilityConfigurationError(definition, providers)
  if (error) throw error

  return { providerId: definition.defaultProvider, providers }
}

export function resolveFallbackCapability<const TDefinition extends FallbackCapabilityDefinition>(
  definition: TDefinition,
  values: EnvCapabilityValues
): FallbackCapabilityResolution<ProviderId<TDefinition>> {
  const providers = definition.providers.map((provider) => inspectProvider(provider, values))
  const providerIds = providers
    .filter((provider) => provider.state === 'ready')
    .map((provider) => provider.id) as ProviderId<TDefinition>[]

  if (providerIds.length === 0) {
    const error = getCapabilityConfigurationError(definition, providers)
    if (error) throw error
  }

  return { configured: providerIds.length > 0, providerIds, providers }
}

export interface WireFallbackOptions<TDefinition extends FallbackCapabilityDefinition, TProvider> {
  definition: TDefinition
  values: EnvCapabilityValues
  factories: FallbackFactories<TDefinition, TProvider>
  onFailure?: (providerId: ProviderId<TDefinition>, error: unknown) => void
}

export function wireFallback<const TDefinition extends FallbackCapabilityDefinition, TProvider>({
  definition,
  values,
  factories,
  onFailure,
}: WireFallbackOptions<TDefinition, TProvider>) {
  const resolution = resolveFallbackCapability(definition, values)
  const providers = resolution.providerIds.map((providerId) => {
    const provider = factories[providerId]()
    if (!provider) {
      throw new EnvCapabilityConfigurationError(
        definition.id,
        `${definition.label} provider ${providerId} resolved as ready but its factory returned null`
      )
    }
    return { id: providerId, provider }
  })

  return {
    configured: resolution.configured,
    providerIds: resolution.providerIds,
    providers: providers.map(({ provider }) => provider),
    async execute<TResult>(
      operation: (provider: TProvider, providerId: ProviderId<TDefinition>) => Promise<TResult>
    ): Promise<TResult> {
      if (resolution.providerIds.length === 0) {
        throw new EnvCapabilityConfigurationError(
          definition.id,
          `${definition.label} is not configured. Run ${definition.setupCommand}.`
        )
      }

      const failures: unknown[] = []
      for (const { id: providerId, provider } of providers) {
        try {
          return await operation(provider, providerId)
        } catch (error) {
          failures.push(error)
          onFailure?.(providerId, error)
        }
      }

      throw new AggregateError(
        failures,
        `All ${definition.label} providers failed: ${resolution.providerIds.join(', ')}`
      )
    },
  }
}

export const EMAIL_CAPABILITY = defineFallbackCapability({
  strategy: 'fallback',
  id: 'email',
  label: 'Email',
  setupCommand: 'bun run setup email',
  providers: [
    {
      id: 'resend',
      label: 'Resend',
      activation: ['RESEND_API_KEY'],
      requires: envField('RESEND_API_KEY'),
      setupFields: ['RESEND_API_KEY'],
    },
    {
      id: 'ses',
      label: 'Amazon SES',
      activation: ['AWS_SES_REGION'],
      requires: envField('AWS_SES_REGION'),
      setupFields: ['AWS_SES_REGION'],
    },
    {
      id: 'smtp',
      label: 'SMTP',
      activation: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'],
      requires: allOf(envField('SMTP_HOST'), envField('SMTP_PORT', { format: 'port' })),
      setupFields: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'],
    },
    {
      id: 'azure',
      label: 'Azure Communication Services',
      activation: ['AZURE_ACS_CONNECTION_STRING'],
      requires: envField('AZURE_ACS_CONNECTION_STRING'),
      setupFields: ['AZURE_ACS_CONNECTION_STRING'],
    },
    {
      id: 'gmail',
      label: 'Gmail',
      activation: ['GMAIL_CREDENTIALS_JSON', 'GMAIL_SENDER'],
      requires: allOf(
        envField('GMAIL_CREDENTIALS_JSON', { format: 'gmail-service-account' }),
        envField('GMAIL_SENDER')
      ),
      setupFields: ['GMAIL_CREDENTIALS_JSON', 'GMAIL_SENDER'],
    },
  ],
} as const)

export const STORAGE_CAPABILITY = defineSelectedCapability({
  strategy: 'selected',
  id: 'storage',
  label: 'File storage',
  setupCommand: 'bun run setup storage',
  selectorKey: 'STORAGE_PROVIDER',
  defaultProvider: 'local',
  providers: [
    {
      id: 'azure',
      label: 'Azure Blob Storage',
      activation: [
        'AZURE_CONNECTION_STRING',
        'AZURE_ACCOUNT_NAME',
        'AZURE_ACCOUNT_KEY',
        'AZURE_STORAGE_CONTAINER_NAME',
      ],
      requires: allOf(
        envField('AZURE_STORAGE_CONTAINER_NAME'),
        anyOf(
          envField('AZURE_CONNECTION_STRING'),
          allOf(envField('AZURE_ACCOUNT_NAME'), envField('AZURE_ACCOUNT_KEY'))
        )
      ),
      setupFields: [
        'AZURE_CONNECTION_STRING',
        'AZURE_ACCOUNT_NAME',
        'AZURE_ACCOUNT_KEY',
        'AZURE_STORAGE_CONTAINER_NAME',
      ],
    },
    {
      id: 's3',
      label: 'S3',
      activation: [
        'S3_BUCKET_NAME',
        'S3_KB_BUCKET_NAME',
        'S3_EXECUTION_FILES_BUCKET_NAME',
        'S3_CHAT_BUCKET_NAME',
        'S3_COPILOT_BUCKET_NAME',
        'S3_PROFILE_PICTURES_BUCKET_NAME',
        'S3_OG_IMAGES_BUCKET_NAME',
        'S3_WORKSPACE_LOGOS_BUCKET_NAME',
        'S3_ENDPOINT',
      ],
      requires: allOf(envField('AWS_REGION'), envField('S3_BUCKET_NAME')),
      pairedFields: [['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']],
      optionalFields: [envField('S3_ENDPOINT', { format: 'http-url' })],
      setupFields: [
        'AWS_REGION',
        'AWS_ACCESS_KEY_ID',
        'AWS_SECRET_ACCESS_KEY',
        'S3_BUCKET_NAME',
        'S3_ENDPOINT',
        'S3_FORCE_PATH_STYLE',
      ],
    },
    {
      id: 'gcs',
      label: 'Google Cloud Storage',
      activation: ['GCS_BUCKET_NAME'],
      requires: envField('GCS_BUCKET_NAME'),
      optionalFields: [envField('GCS_CREDENTIALS_JSON', { format: 'gmail-service-account' })],
      setupFields: ['GCS_BUCKET_NAME', 'GCS_PROJECT_ID', 'GCS_CREDENTIALS_JSON'],
    },
  ],
} as const)

export type SandboxProviderCapabilityId = 'e2b' | 'daytona'

/** Selects the legacy sandbox provider without requiring credentials until it is used. */
export function selectSandboxProviderId(values: EnvCapabilityValues): SandboxProviderCapabilityId {
  const configured = hasValue(values, 'SANDBOX_PROVIDER')
    ? String(readValue(values, 'SANDBOX_PROVIDER')).toLowerCase()
    : 'e2b'
  if (configured !== 'e2b' && configured !== 'daytona') {
    throw new EnvCapabilityConfigurationError(
      'sandbox',
      `Unknown SANDBOX_PROVIDER "${readValue(values, 'SANDBOX_PROVIDER')}" (expected e2b or daytona)`
    )
  }
  return configured
}

export function resolveSandboxProviderId(values: EnvCapabilityValues): SandboxProviderCapabilityId {
  const configured = selectSandboxProviderId(values)
  if (configured === 'daytona') {
    const missing = ['DAYTONA_API_KEY', 'DAYTONA_SHELL_SNAPSHOT_ID'].filter(
      (key) => !hasValue(values, key)
    )
    if (missing.length > 0) {
      const verb = missing.length === 1 ? 'is' : 'are'
      throw new EnvCapabilityConfigurationError(
        'sandbox',
        `SANDBOX_PROVIDER selects Daytona but ${missing.join(', ')} ${verb} missing. Run bun run setup sandbox.`
      )
    }
    const snapshot = readValue(values, 'DAYTONA_SHELL_SNAPSHOT_ID')
    if (!isValidEnvCapabilityFieldValue('daytona-snapshot', snapshot)) {
      throw new EnvCapabilityConfigurationError(
        'sandbox',
        'DAYTONA_SHELL_SNAPSHOT_ID must use an explicit, non-floating name:tag. Run bun run setup sandbox.'
      )
    }
    return configured
  }
  if (
    configured === 'e2b' &&
    isTruthyValue(values, 'E2B_ENABLED') &&
    !hasValue(values, 'E2B_API_KEY')
  ) {
    throw new EnvCapabilityConfigurationError(
      'sandbox',
      'E2B_ENABLED is on but E2B_API_KEY is missing. Run bun run setup sandbox.'
    )
  }
  return configured
}

export function resolveAsyncJobsProvider(values: EnvCapabilityValues): 'database' | 'trigger-dev' {
  if (!isTruthyValue(values, 'TRIGGER_DEV_ENABLED')) return 'database'
  const missing = ['TRIGGER_SECRET_KEY', 'TRIGGER_PROJECT_ID'].filter(
    (key) => !hasValue(values, key)
  )
  if (missing.length > 0) {
    throw new EnvCapabilityConfigurationError(
      'jobs',
      `TRIGGER_DEV_ENABLED is on but ${missing.join(', ')} is missing. Run bun run setup jobs.`
    )
  }
  return 'trigger-dev'
}

export function resolveCacheProvider(values: EnvCapabilityValues): 'database' | 'redis' {
  if (!hasValue(values, 'REDIS_URL')) return 'database'
  const redisUrl = String(readValue(values, 'REDIS_URL'))
  let parsed: URL
  try {
    parsed = new URL(redisUrl)
  } catch {
    throw new EnvCapabilityConfigurationError('cache', 'REDIS_URL must be a valid URL')
  }
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new EnvCapabilityConfigurationError(
      'cache',
      'REDIS_URL must use the redis:// or rediss:// protocol'
    )
  }
  if (
    parsed.protocol === 'rediss:' &&
    /^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname) &&
    !hasValue(values, 'REDIS_TLS_SERVERNAME')
  ) {
    throw new EnvCapabilityConfigurationError(
      'cache',
      'REDIS_TLS_SERVERNAME is required when REDIS_URL uses rediss:// with an IP address'
    )
  }
  return 'redis'
}

export function resolveOcrProvider(
  values: EnvCapabilityValues
): 'azure-mistral' | 'mistral' | 'local' {
  const selected = hasValue(values, 'OCR_PROVIDER')
    ? String(readValue(values, 'OCR_PROVIDER')).toLowerCase()
    : null
  if (selected && selected !== 'local' && selected !== 'mistral' && selected !== 'azure-mistral') {
    throw new EnvCapabilityConfigurationError(
      'knowledge',
      `Unknown OCR_PROVIDER "${readValue(values, 'OCR_PROVIDER')}" (expected local, mistral, or azure-mistral)`
    )
  }
  if (selected === 'local') return 'local'
  if (selected === 'mistral') {
    if (!hasValue(values, 'MISTRAL_API_KEY')) {
      throw new EnvCapabilityConfigurationError(
        'knowledge',
        'OCR_PROVIDER selects Mistral but MISTRAL_API_KEY is missing. Run bun run setup knowledge.'
      )
    }
    return 'mistral'
  }

  const azureFields = ['OCR_AZURE_API_KEY', 'OCR_AZURE_ENDPOINT', 'OCR_AZURE_MODEL_NAME'] as const
  const present = azureFields.filter((key) => hasValue(values, key))
  const invalidAzureEndpoint =
    hasValue(values, 'OCR_AZURE_ENDPOINT') &&
    !isValidEnvCapabilityFieldValue('http-url', readValue(values, 'OCR_AZURE_ENDPOINT'))

  if (selected === 'azure-mistral') {
    if (invalidAzureEndpoint) {
      throw new EnvCapabilityConfigurationError(
        'knowledge',
        'OCR_AZURE_ENDPOINT must be a valid HTTP(S) URL. Run bun run setup knowledge.'
      )
    }
    if (present.length !== azureFields.length) {
      const missing = azureFields.filter((key) => !hasValue(values, key))
      throw new EnvCapabilityConfigurationError(
        'knowledge',
        `OCR_PROVIDER selects Azure Mistral but ${missing.join(', ')} is missing. Run bun run setup knowledge.`
      )
    }
    return 'azure-mistral'
  }

  if (present.length === azureFields.length) {
    if (invalidAzureEndpoint) {
      throw new EnvCapabilityConfigurationError(
        'knowledge',
        'OCR_AZURE_ENDPOINT must be a valid HTTP(S) URL. Run bun run setup knowledge.'
      )
    }
    return 'azure-mistral'
  }

  if (hasValue(values, 'MISTRAL_API_KEY')) return 'mistral'

  if (invalidAzureEndpoint) {
    throw new EnvCapabilityConfigurationError(
      'knowledge',
      'OCR_AZURE_ENDPOINT must be a valid HTTP(S) URL. Run bun run setup knowledge.'
    )
  }
  if (present.length > 0 && present.length < azureFields.length) {
    const missing = azureFields.filter((key) => !hasValue(values, key))
    throw new EnvCapabilityConfigurationError(
      'knowledge',
      `Azure Mistral OCR is partially configured — missing ${missing.join(', ')}. Run bun run setup knowledge.`
    )
  }
  return 'local'
}

export const OAUTH_CLIENT_CAPABILITIES = {
  google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  x: ['X_CLIENT_ID', 'X_CLIENT_SECRET'],
  tiktok: ['TIKTOK_CLIENT_ID', 'TIKTOK_CLIENT_SECRET'],
  confluence: ['CONFLUENCE_CLIENT_ID', 'CONFLUENCE_CLIENT_SECRET'],
  jira: ['JIRA_CLIENT_ID', 'JIRA_CLIENT_SECRET'],
  calcom: ['CALCOM_CLIENT_ID'],
  airtable: ['AIRTABLE_CLIENT_ID', 'AIRTABLE_CLIENT_SECRET'],
  notion: ['NOTION_CLIENT_ID', 'NOTION_CLIENT_SECRET'],
  microsoft: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'],
  clickup: ['CLICKUP_CLIENT_ID', 'CLICKUP_CLIENT_SECRET'],
  linear: ['LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET'],
  attio: ['ATTIO_CLIENT_ID', 'ATTIO_CLIENT_SECRET'],
  box: ['BOX_CLIENT_ID', 'BOX_CLIENT_SECRET'],
  docusign: ['DOCUSIGN_CLIENT_ID', 'DOCUSIGN_CLIENT_SECRET'],
  dropbox: ['DROPBOX_CLIENT_ID', 'DROPBOX_CLIENT_SECRET'],
  slack: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET'],
  reddit: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'],
  wealthbox: ['WEALTHBOX_CLIENT_ID', 'WEALTHBOX_CLIENT_SECRET'],
  webflow: ['WEBFLOW_CLIENT_ID', 'WEBFLOW_CLIENT_SECRET'],
  asana: ['ASANA_CLIENT_ID', 'ASANA_CLIENT_SECRET'],
  pipedrive: ['PIPEDRIVE_CLIENT_ID', 'PIPEDRIVE_CLIENT_SECRET'],
  hubspot: ['HUBSPOT_CLIENT_ID', 'HUBSPOT_CLIENT_SECRET'],
  linkedin: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
  instagram: ['INSTAGRAM_CLIENT_ID', 'INSTAGRAM_CLIENT_SECRET'],
  salesforce: ['SALESFORCE_CLIENT_ID', 'SALESFORCE_CLIENT_SECRET'],
  shopify: ['SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'],
  zoom: ['ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET'],
  wordpress: ['WORDPRESS_CLIENT_ID', 'WORDPRESS_CLIENT_SECRET'],
  spotify: ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET'],
  monday: ['MONDAY_CLIENT_ID', 'MONDAY_CLIENT_SECRET'],
  trello: ['TRELLO_API_KEY'],
  'zoho-desk': ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET'],
} as const

export const SETUP_FEATURES = [
  { id: 'email', label: 'Email delivery' },
  { id: 'storage', label: 'File storage' },
  { id: 'sandbox', label: 'Remote sandboxes' },
  { id: 'jobs', label: 'Async jobs' },
  { id: 'cache', label: 'Redis cache' },
  { id: 'knowledge', label: 'Knowledge and OCR' },
  { id: 'llm', label: 'LLM API keys' },
  { id: 'integration', label: 'OAuth integration' },
] as const

export type SetupFeatureId = (typeof SETUP_FEATURES)[number]['id']

export const LLM_KEY_POOLS = {
  openai: {
    keys: ['OPENAI_API_KEY_1', 'OPENAI_API_KEY_2', 'OPENAI_API_KEY_3'],
    fallbackKey: 'OPENAI_API_KEY',
  },
  anthropic: {
    keys: ['ANTHROPIC_API_KEY_1', 'ANTHROPIC_API_KEY_2', 'ANTHROPIC_API_KEY_3'],
  },
  gemini: {
    keys: ['GEMINI_API_KEY_1', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3'],
    fallbackKey: 'GEMINI_API_KEY',
  },
  cohere: {
    keys: ['COHERE_API_KEY_1', 'COHERE_API_KEY_2', 'COHERE_API_KEY_3'],
    fallbackKey: 'COHERE_API_KEY',
  },
  zai: { keys: ['ZAI_API_KEY_1', 'ZAI_API_KEY_2', 'ZAI_API_KEY_3'] },
  xai: { keys: ['XAI_API_KEY_1', 'XAI_API_KEY_2', 'XAI_API_KEY_3'] },
  kimi: { keys: ['KIMI_API_KEY_1', 'KIMI_API_KEY_2', 'KIMI_API_KEY_3'] },
  fireworks: {
    keys: ['FIREWORKS_API_KEY_1', 'FIREWORKS_API_KEY_2', 'FIREWORKS_API_KEY_3'],
    fallbackKey: 'FIREWORKS_API_KEY',
  },
} as const

/**
 * Environment keys whose process-level values can change setup status or make a
 * setup write ineffective. The setup CLI uses this exact runtime-owned list to
 * avoid claiming it manages a development configuration shadowed by the shell.
 */
export const DEPLOYMENT_CONFIGURATION_KEYS: readonly string[] = [
  ...new Set([
    ...CORE_CONFIGURATION_KEYS,
    ...capabilityKeys(EMAIL_CAPABILITY),
    ...capabilityKeys(STORAGE_CAPABILITY),
    'EMAIL_VERIFICATION_ENABLED',
    'SANDBOX_PROVIDER',
    'DAYTONA_API_KEY',
    'DAYTONA_SHELL_SNAPSHOT_ID',
    'E2B_ENABLED',
    'E2B_API_KEY',
    'NEXT_PUBLIC_E2B_ENABLED',
    'NEXT_PUBLIC_SANDBOX_ENABLED',
    'TRIGGER_DEV_ENABLED',
    'TRIGGER_PROJECT_ID',
    'TRIGGER_SECRET_KEY',
    'REDIS_URL',
    'REDIS_TLS_SERVERNAME',
    'OCR_PROVIDER',
    'MISTRAL_API_KEY',
    'OCR_AZURE_API_KEY',
    'OCR_AZURE_ENDPOINT',
    'OCR_AZURE_MODEL_NAME',
    ...Object.values(LLM_KEY_POOLS).flatMap((pool) => [
      ...pool.keys,
      ...('fallbackKey' in pool ? [pool.fallbackKey] : []),
    ]),
    ...Object.values(OAUTH_CLIENT_CAPABILITIES).flat(),
  ]),
]

export type OAuthClientCapabilityId = keyof typeof OAUTH_CLIENT_CAPABILITIES
export type OAuthClientCapabilityField<TCapabilityId extends OAuthClientCapabilityId> =
  (typeof OAUTH_CLIENT_CAPABILITIES)[TCapabilityId][number]

export interface ConfiguredOAuthClient<TField extends string = string> {
  state: 'ready'
  missingFields: readonly []
  setupCommand: string
  values: Readonly<Record<TField, string>>
}

const GOOGLE_OAUTH_SERVICES = new Set([
  'gmail',
  'google-email',
  'google-drive',
  'google-docs',
  'google-sheets',
  'google-calendar',
  'google-contacts',
  'google-ads',
  'google-bigquery',
  'google-tasks',
  'google-vault',
  'google-forms',
  'google-groups',
  'google-meet',
  'vertex-ai',
])

const MICROSOFT_OAUTH_SERVICES = new Set([
  'microsoft',
  'outlook',
  'onedrive',
  'sharepoint',
  'microsoft-ad',
  'microsoft-dataverse',
  'microsoft-excel',
  'microsoft-teams',
  'microsoft-planner',
])

export function resolveOAuthClientCapabilityId(serviceId: string): OAuthClientCapabilityId | null {
  const normalized = serviceId.toLowerCase().replace(/_/g, '-')
  if (GOOGLE_OAUTH_SERVICES.has(normalized)) return 'google'
  if (MICROSOFT_OAUTH_SERVICES.has(normalized)) return 'microsoft'
  if (normalized === 'zoho') return 'zoho-desk'
  return normalized in OAUTH_CLIENT_CAPABILITIES ? (normalized as OAuthClientCapabilityId) : null
}

export function getOAuthClientCapabilityFields(serviceId: string): readonly string[] | null {
  const providerId = resolveOAuthClientCapabilityId(serviceId)
  return providerId ? OAUTH_CLIENT_CAPABILITIES[providerId] : null
}

export interface OAuthClientCapabilityInspection {
  state: ProviderConfigurationState
  missingFields: readonly string[]
  setupCommand: string
}

function readOAuthClientFieldValue(values: EnvCapabilityValues, key: string): string | null {
  const value = readValue(values, key)
  if (typeof value !== 'string' || !hasValue(values, key)) return null
  return value
}

export function inspectOAuthClientCapability(
  providerId: string,
  values: EnvCapabilityValues
): OAuthClientCapabilityInspection {
  const capabilityId = resolveOAuthClientCapabilityId(providerId)
  const fields = capabilityId ? OAUTH_CLIENT_CAPABILITIES[capabilityId] : null
  if (!fields) {
    return {
      state: 'absent',
      missingFields: [],
      setupCommand: `bun run setup integration ${providerId}`,
    }
  }

  const present = fields.filter((key) => readOAuthClientFieldValue(values, key) !== null)
  return {
    state: present.length === 0 ? 'absent' : present.length === fields.length ? 'ready' : 'partial',
    missingFields: fields.filter((key) => readOAuthClientFieldValue(values, key) === null),
    setupCommand: `bun run setup integration ${providerId}`,
  }
}

export function requireOAuthClientCapability<const TCapabilityId extends OAuthClientCapabilityId>(
  providerId: TCapabilityId,
  values: EnvCapabilityValues
): ConfiguredOAuthClient<OAuthClientCapabilityField<TCapabilityId>>
export function requireOAuthClientCapability(
  providerId: string,
  values: EnvCapabilityValues
): ConfiguredOAuthClient
export function requireOAuthClientCapability(
  providerId: string,
  values: EnvCapabilityValues
): ConfiguredOAuthClient {
  const inspection = inspectOAuthClientCapability(providerId, values)
  if (inspection.state !== 'ready') {
    const detail =
      inspection.state === 'partial' || inspection.state === 'invalid'
        ? ` is partially configured — missing ${inspection.missingFields.join(', ')}`
        : ' is not configured'
    throw new EnvCapabilityConfigurationError(
      'oauth',
      `OAuth client ${providerId}${detail}. Run ${inspection.setupCommand}.`
    )
  }

  const fields = getOAuthClientCapabilityFields(providerId)
  if (!fields) {
    throw new EnvCapabilityConfigurationError(
      'oauth',
      `OAuth client ${providerId} has no capability definition. Run ${inspection.setupCommand}.`
    )
  }

  const configuredValues: Record<string, string> = {}
  for (const field of fields) {
    const value = readOAuthClientFieldValue(values, field)
    if (value === null) {
      throw new EnvCapabilityConfigurationError(
        'oauth',
        `OAuth client ${providerId} has an invalid ${field}. Run ${inspection.setupCommand}.`
      )
    }
    configuredValues[field] = value
  }

  return {
    ...inspection,
    state: 'ready',
    missingFields: [],
    values: configuredValues,
  }
}
