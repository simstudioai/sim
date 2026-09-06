/**
 * Canonical runtime deployment-capability definitions. Keep this module free of application
 * runtime dependencies so setup and diagnostics can consume the rules the app enforces.
 *
 * @packageDocumentation
 */
import {
  IMMUTABLE_DAYTONA_SNAPSHOT_REF_ERROR,
  IMMUTABLE_E2B_TEMPLATE_REF_ERROR,
  isImmutableDaytonaSnapshotRef,
  isImmutableE2BTemplateRef,
  isValidSandboxReleaseGeneration,
  SANDBOX_RELEASE_GENERATION_ERROR,
} from '@sim/utils/sandbox-references'

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

export type EnvValueValidation =
  | {
      kind: 'integer'
      min?: number
      max?: number
      message: string
    }
  | {
      kind: 'json-object'
      requiredStringFields?: readonly string[]
      message: string
    }
  | {
      kind: 'pattern'
      pattern: RegExp
      message: string
    }
  | {
      kind: 'immutable-e2b-template-ref'
      message: string
    }
  | {
      kind: 'immutable-daytona-snapshot-ref'
      message: string
    }
  | {
      kind: 'sandbox-release-generation'
      message: string
    }
  | {
      kind: 'url'
      protocols?: readonly string[]
      message: string
    }

export interface EnvFieldRequirement {
  type: 'field'
  key: string
  validation?: EnvValueValidation
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

export type EnvProviderActivation =
  | { mode: 'any-present'; keys: readonly string[] }
  | { mode: 'enabled'; key: string }

export interface EnvProviderValidationIssue {
  kind: 'missing' | 'invalid'
  fields: readonly string[]
  message: string
}

export interface EnvProviderDefinition<TId extends string = string> {
  id: TId
  label: string
  activation: EnvProviderActivation
  /**
   * Narrows {@link activation} for a capability whose providers are chosen by
   * something a key-presence check cannot express — knowledge embeddings pick a
   * family from the *value* of `KB_EMBEDDING_MODEL`, so credentials for the
   * other families must not read as configured. Applied on top of activation,
   * never instead of it: a provider still needs its own keys present.
   */
  activeWhen?: (values: EnvCapabilityValues) => boolean
  requires: EnvRequirement
  pairedFields?: readonly (readonly [string, string])[]
  optionalFields?: readonly EnvFieldRequirement[]
  validate?: (values: EnvCapabilityValues) => readonly EnvProviderValidationIssue[]
}

export interface FallbackCapabilityDefinition<
  TId extends string = string,
  TProvider extends EnvProviderDefinition = EnvProviderDefinition,
> {
  strategy: 'fallback'
  id: TId
  label: string
  providers: readonly TProvider[]
}

export type EnvDefaultProviderDefinition =
  | { id: string; kind: 'built-in'; label: string }
  | { id: string; kind: 'provider' }

export interface SelectedCapabilityDefinition<
  TId extends string = string,
  TProvider extends EnvProviderDefinition = EnvProviderDefinition,
> {
  strategy: 'selected'
  id: TId
  label: string
  selectorKey?: string
  whenUnset: 'default' | 'first-ready'
  defaultProvider: EnvDefaultProviderDefinition
  providers: readonly TProvider[]
}

export type CapabilityDefinition = FallbackCapabilityDefinition | SelectedCapabilityDefinition

export type DeclaredProviderId<TDefinition extends CapabilityDefinition> =
  TDefinition['providers'][number]['id']

export type ProviderId<TDefinition extends CapabilityDefinition> =
  TDefinition extends SelectedCapabilityDefinition
    ? DeclaredProviderId<TDefinition> | TDefinition['defaultProvider']['id']
    : DeclaredProviderId<TDefinition>

export type FallbackFactories<TDefinition extends FallbackCapabilityDefinition, TProvider> = {
  [TId in DeclaredProviderId<TDefinition>]: () => TProvider | null
}

export type ProviderConfigurationState = 'absent' | 'partial' | 'ready' | 'invalid'

export interface ProviderInspection<TId extends string = string> {
  id: TId
  label: string
  active: boolean
  state: ProviderConfigurationState
  missingFields: readonly string[]
  invalidFields: readonly string[]
  invalidDetails: readonly string[]
}

export interface FallbackCapabilityInspection<TId extends string = string> {
  strategy: 'fallback'
  configured: boolean
  providerIds: readonly TId[]
  providers: readonly ProviderInspection<TId>[]
  error: EnvCapabilityConfigurationError | null
}

export interface SelectedCapabilityInspection<
  TProviderId extends string = string,
  TDeclaredProviderId extends string = TProviderId,
> {
  strategy: 'selected'
  providerId: TProviderId | null
  providers: readonly ProviderInspection<TDeclaredProviderId>[]
  error: EnvCapabilityConfigurationError | null
}

export type CapabilityInspection<TDefinition extends CapabilityDefinition> =
  TDefinition extends SelectedCapabilityDefinition
    ? SelectedCapabilityInspection<ProviderId<TDefinition>, DeclaredProviderId<TDefinition>>
    : FallbackCapabilityInspection<DeclaredProviderId<TDefinition>>

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
  options: Pick<EnvFieldRequirement, 'validation'> = {}
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

function activationKeys(activation: EnvProviderActivation): readonly string[] {
  return activation.mode === 'enabled' ? [activation.key] : activation.keys
}

function providerKeys(provider: EnvProviderDefinition): string[] {
  return [
    ...activationKeys(provider.activation),
    ...requirementKeys(provider.requires),
    ...(provider.pairedFields ?? []).flat(),
    ...(provider.optionalFields ?? []).map((field) => field.key),
  ]
}

/** Returns every environment field that can affect one provider at runtime. */
export function getProviderFields(provider: EnvProviderDefinition): readonly string[] {
  return unique(providerKeys(provider))
}

function providerIsActive(provider: EnvProviderDefinition, values: EnvCapabilityValues): boolean {
  const activated =
    provider.activation.mode === 'enabled'
      ? isTruthyValue(values, provider.activation.key)
      : provider.activation.keys.some((key) => hasValue(values, key))
  return activated && (provider.activeWhen?.(values) ?? true)
}

function capabilityKeys(definition: CapabilityDefinition): string[] {
  return [
    ...(definition.strategy === 'selected' && definition.selectorKey
      ? [definition.selectorKey]
      : []),
    ...definition.providers.flatMap(providerKeys),
  ]
}

/** Returns every environment field that can affect a capability at runtime. */
export function getCapabilityFields(definition: CapabilityDefinition): readonly string[] {
  return unique(capabilityKeys(definition))
}

function assertRequirementDefinition(
  capabilityId: string,
  providerId: string,
  requirement: EnvRequirement
): void {
  if (requirement.type === 'field') {
    if (!requirement.key) {
      throw new Error(`Capability ${capabilityId} provider ${providerId} has an empty field key`)
    }
    return
  }
  if (requirement.requirements.length === 0) {
    throw new Error(
      `Capability ${capabilityId} provider ${providerId} has an empty ${requirement.type}`
    )
  }
  for (const child of requirement.requirements) {
    assertRequirementDefinition(capabilityId, providerId, child)
  }
}

function assertCapabilityDefinition(definition: CapabilityDefinition): void {
  if (definition.providers.length === 0) {
    throw new Error(`Capability ${definition.id} must declare at least one provider`)
  }

  const providerIds = definition.providers.map((provider) => provider.id)
  if (new Set(providerIds).size !== providerIds.length) {
    throw new Error(`Capability ${definition.id} has duplicate provider ids`)
  }

  if (definition.strategy === 'selected') {
    const defaultIsDeclared = providerIds.includes(definition.defaultProvider.id)
    if (definition.defaultProvider.kind === 'provider' && !defaultIsDeclared) {
      throw new Error(
        `Capability ${definition.id} default provider ${definition.defaultProvider.id} is not declared`
      )
    }
    if (definition.defaultProvider.kind === 'built-in' && defaultIsDeclared) {
      throw new Error(
        `Capability ${definition.id} built-in default ${definition.defaultProvider.id} also appears in providers`
      )
    }
  }

  for (const provider of definition.providers) {
    if (provider.activation.mode === 'any-present' && provider.activation.keys.length === 0) {
      throw new Error(`Capability ${definition.id} provider ${provider.id} has no activation keys`)
    }
    assertRequirementDefinition(definition.id, provider.id, provider.requires)
  }
}

export function defineCapability<const TDefinition extends CapabilityDefinition>(
  definition: TDefinition
): TDefinition {
  assertCapabilityDefinition(definition)
  return definition
}

/** Returns the canonical command for configuring a runtime capability. */
export function getCapabilitySetupCommand(definition: CapabilityDefinition): string {
  return `npx sim-setup add ${definition.id}`
}

interface RequirementInspection {
  ready: boolean
  missingFields: readonly string[]
  invalidFields: readonly string[]
  invalidDetails: readonly string[]
}

function isValidEnvCapabilityFieldValue(
  validation: EnvValueValidation,
  value: EnvCapabilityValue
): boolean {
  const serialized = String(value)
  if (validation.kind === 'integer') {
    const number = Number(serialized)
    return (
      Number.isInteger(number) &&
      (validation.min === undefined || number >= validation.min) &&
      (validation.max === undefined || number <= validation.max)
    )
  }
  if (validation.kind === 'json-object') {
    try {
      const parsed: unknown = JSON.parse(serialized)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false
      return (validation.requiredStringFields ?? []).every(
        (field) =>
          field in parsed &&
          typeof (parsed as Record<string, unknown>)[field] === 'string' &&
          ((parsed as Record<string, unknown>)[field] as string).length > 0
      )
    } catch {
      return false
    }
  }
  if (validation.kind === 'pattern') {
    validation.pattern.lastIndex = 0
    return validation.pattern.test(serialized)
  }
  if (validation.kind === 'immutable-e2b-template-ref') {
    return isImmutableE2BTemplateRef(serialized)
  }
  if (validation.kind === 'immutable-daytona-snapshot-ref') {
    return isImmutableDaytonaSnapshotRef(serialized)
  }
  if (validation.kind === 'sandbox-release-generation') {
    return isValidSandboxReleaseGeneration(serialized)
  }
  try {
    const parsed = new URL(serialized)
    return !validation.protocols || validation.protocols.includes(parsed.protocol)
  } catch {
    return false
  }
}

function inspectField(
  requirement: EnvFieldRequirement,
  values: EnvCapabilityValues
): RequirementInspection {
  if (!hasValue(values, requirement.key)) {
    return {
      ready: false,
      missingFields: [requirement.key],
      invalidFields: [],
      invalidDetails: [],
    }
  }

  const value = readValue(values, requirement.key)
  const valid = requirement.validation
    ? isValidEnvCapabilityFieldValue(requirement.validation, value)
    : true

  return valid
    ? { ready: true, missingFields: [], invalidFields: [], invalidDetails: [] }
    : {
        ready: false,
        missingFields: [],
        invalidFields: [requirement.key],
        invalidDetails: [`${requirement.key} ${requirement.validation?.message ?? 'is invalid'}`],
      }
}

function inspectRequirement(
  requirement: EnvRequirement,
  values: EnvCapabilityValues
): RequirementInspection {
  if (requirement.type === 'field') return inspectField(requirement, values)

  const inspections = requirement.requirements.map((child) => inspectRequirement(child, values))
  if (requirement.type === 'anyOf') {
    const ready = inspections.find((inspection) => inspection.ready)
    if (ready) return ready
    return inspections.reduce((best, candidate) => {
      const bestIssueCount = best.missingFields.length + best.invalidFields.length
      const candidateIssueCount = candidate.missingFields.length + candidate.invalidFields.length
      return candidateIssueCount < bestIssueCount ? candidate : best
    })
  }

  return {
    ready: inspections.every((inspection) => inspection.ready),
    missingFields: unique(inspections.flatMap((inspection) => inspection.missingFields)),
    invalidFields: unique(inspections.flatMap((inspection) => inspection.invalidFields)),
    invalidDetails: unique(inspections.flatMap((inspection) => inspection.invalidDetails)),
  }
}

function inspectProviderRequirements<const TProvider extends EnvProviderDefinition>(
  provider: TProvider,
  values: EnvCapabilityValues,
  active = true
): ProviderInspection<TProvider['id']> {
  const inspection = inspectRequirement(provider.requires, values)
  const invalidOptionalFields = (provider.optionalFields ?? []).flatMap((field) => {
    if (!hasValue(values, field.key)) return []
    return inspectField(field, values).invalidFields
  })
  const invalidPairs = (provider.pairedFields ?? []).flatMap(([left, right]) =>
    hasValue(values, left) === hasValue(values, right) ? [] : [left, right]
  )
  const customIssues = provider.validate?.(values) ?? []
  const missingFields = unique([
    ...inspection.missingFields,
    ...customIssues
      .filter((customIssue) => customIssue.kind === 'missing')
      .flatMap((customIssue) => customIssue.fields),
  ])
  const invalidFields = unique([
    ...inspection.invalidFields,
    ...invalidOptionalFields,
    ...invalidPairs,
    ...customIssues
      .filter((customIssue) => customIssue.kind === 'invalid')
      .flatMap((customIssue) => customIssue.fields),
  ])
  const invalidDetails = unique([
    ...inspection.invalidDetails,
    ...(provider.optionalFields ?? []).flatMap((field) => {
      if (!hasValue(values, field.key)) return []
      return inspectField(field, values).invalidDetails
    }),
    ...(provider.pairedFields ?? []).flatMap(([left, right]) =>
      hasValue(values, left) === hasValue(values, right)
        ? []
        : [`${left} and ${right} must be set together`]
    ),
    ...customIssues.map((customIssue) => customIssue.message),
  ])
  return {
    id: provider.id,
    label: provider.label,
    active,
    state:
      invalidFields.length > 0
        ? 'invalid'
        : missingFields.length > 0 || !inspection.ready
          ? 'partial'
          : 'ready',
    missingFields,
    invalidFields,
    invalidDetails,
  }
}

function inspectRequiredProvider<const TProvider extends EnvProviderDefinition>(
  provider: TProvider,
  values: EnvCapabilityValues
): ProviderInspection<TProvider['id']> {
  const active = providerIsActive(provider, values)
  const inspection = inspectProviderRequirements(provider, values, active)
  if (active || provider.activation.mode !== 'enabled') return inspection

  return {
    ...inspection,
    state: 'invalid',
    invalidFields: unique([...inspection.invalidFields, provider.activation.key]),
    invalidDetails: unique([
      ...inspection.invalidDetails,
      `${provider.activation.key} must be enabled`,
    ]),
  }
}

export function inspectProvider<const TProvider extends EnvProviderDefinition>(
  provider: TProvider,
  values: EnvCapabilityValues
): ProviderInspection<TProvider['id']> {
  const active = providerIsActive(provider, values)
  return active
    ? inspectProviderRequirements(provider, values, true)
    : {
        id: provider.id,
        label: provider.label,
        active: false,
        state: 'absent',
        missingFields: [],
        invalidFields: [],
        invalidDetails: [],
      }
}

function providerProblems(inspection: ProviderInspection): string {
  return [
    inspection.missingFields.length > 0 ? `missing ${inspection.missingFields.join(', ')}` : null,
    inspection.invalidDetails.length > 0
      ? inspection.invalidDetails.join(', ')
      : inspection.invalidFields.length > 0
        ? `invalid ${inspection.invalidFields.join(', ')}`
        : null,
  ]
    .filter(Boolean)
    .join('; ')
}

export function getCapabilityConfigurationError(
  definition: CapabilityDefinition,
  inspections: readonly ProviderInspection[]
): EnvCapabilityConfigurationError | null {
  const broken = inspections.filter(
    (inspection) => inspection.state === 'partial' || inspection.state === 'invalid'
  )
  if (broken.length === 0) return null

  const details = broken.map((inspection) => `${inspection.label}: ${providerProblems(inspection)}`)

  return new EnvCapabilityConfigurationError(
    definition.id,
    `${definition.label} is partially or incorrectly configured (${details.join(' | ')}). Run ${getCapabilitySetupCommand(definition)}.`
  )
}

function replaceProviderInspection<TId extends string>(
  providers: readonly ProviderInspection<TId>[],
  replacement: ProviderInspection<TId>
): ProviderInspection<TId>[] {
  return providers.map((provider) => (provider.id === replacement.id ? replacement : provider))
}

function inspectSelectedCapability<const TDefinition extends SelectedCapabilityDefinition>(
  definition: TDefinition,
  values: EnvCapabilityValues
): SelectedCapabilityInspection<ProviderId<TDefinition>, DeclaredProviderId<TDefinition>> {
  const rawSelector = definition.selectorKey ? readValue(values, definition.selectorKey) : undefined
  const selector =
    definition.selectorKey && hasValue(values, definition.selectorKey)
      ? String(rawSelector).trim().toLowerCase()
      : null
  let providers = definition.providers.map((provider) => inspectProvider(provider, values))
  const known = new Set([
    definition.defaultProvider.id,
    ...definition.providers.map((provider) => provider.id),
  ])

  if (selector && !known.has(selector)) {
    const error = new EnvCapabilityConfigurationError(
      definition.id,
      `Unknown ${definition.selectorKey} "${rawSelector}". Expected one of: ${[...known].join(', ')}`
    )
    return { strategy: 'selected', providerId: null, providers, error }
  }

  if (selector) {
    const selectedDefinition = definition.providers.find((provider) => provider.id === selector)
    if (!selectedDefinition) {
      return {
        strategy: 'selected',
        providerId: definition.defaultProvider.id as ProviderId<TDefinition>,
        providers,
        error: null,
      }
    }
    const active = providerIsActive(selectedDefinition, values)
    const selected =
      !active && selectedDefinition.activation.mode === 'enabled'
        ? inspectProvider(selectedDefinition, values)
        : inspectProviderRequirements(selectedDefinition, values, active)
    providers = replaceProviderInspection(providers, selected)
    const error =
      selected.state === 'ready' ||
      (selected.state === 'absent' && selectedDefinition.activation.mode === 'enabled')
        ? null
        : new EnvCapabilityConfigurationError(
            definition.id,
            `${definition.label} selects ${selector}, but that provider is not configured (${providerProblems(selected)}). Run ${getCapabilitySetupCommand(definition)}.`
          )
    return {
      strategy: 'selected',
      providerId: selector as ProviderId<TDefinition>,
      providers,
      error,
    }
  }

  if (definition.whenUnset === 'default') {
    const defaultDefinition = definition.providers.find(
      (provider) => provider.id === definition.defaultProvider.id
    )
    if (!defaultDefinition) {
      return {
        strategy: 'selected',
        providerId: definition.defaultProvider.id as ProviderId<TDefinition>,
        providers,
        error: null,
      }
    }
    const selected = providers.find((provider) => provider.id === definition.defaultProvider.id)
    return {
      strategy: 'selected',
      providerId: definition.defaultProvider.id as ProviderId<TDefinition>,
      providers,
      error:
        !selected || selected.state === 'ready' || selected.state === 'absent'
          ? null
          : new EnvCapabilityConfigurationError(
              definition.id,
              `${definition.label} selects ${definition.defaultProvider.id}, but that provider is not configured (${providerProblems(selected)}). Run ${getCapabilitySetupCommand(definition)}.`
            ),
    }
  }

  const candidates = providers.filter((provider) => provider.id !== definition.defaultProvider.id)
  for (const candidate of candidates) {
    if (candidate.state === 'ready') {
      return {
        strategy: 'selected',
        providerId: candidate.id as ProviderId<TDefinition>,
        providers,
        error: null,
      }
    }
    if (
      candidate.state === 'invalid' &&
      candidate.missingFields.length === 0 &&
      candidate.invalidFields.length > 0
    ) {
      return {
        strategy: 'selected',
        providerId: candidate.id as ProviderId<TDefinition>,
        providers,
        error: new EnvCapabilityConfigurationError(
          definition.id,
          `${candidate.label} is incorrectly configured (${providerProblems(candidate)}). Run ${getCapabilitySetupCommand(definition)}.`
        ),
      }
    }
  }

  const error = getCapabilityConfigurationError(definition, candidates)
  const broken = candidates.find(
    (provider) => provider.state === 'partial' || provider.state === 'invalid'
  )

  return {
    strategy: 'selected',
    providerId: (broken?.id ?? definition.defaultProvider.id) as ProviderId<TDefinition>,
    providers,
    error,
  }
}

function inspectFallbackCapability<const TDefinition extends FallbackCapabilityDefinition>(
  definition: TDefinition,
  values: EnvCapabilityValues
): FallbackCapabilityInspection<DeclaredProviderId<TDefinition>> {
  const providers = definition.providers.map((provider) => inspectProvider(provider, values))
  const providerIds = providers
    .filter((provider) => provider.state === 'ready')
    .map((provider) => provider.id) as DeclaredProviderId<TDefinition>[]
  const configurationError = getCapabilityConfigurationError(definition, providers)

  return {
    strategy: 'fallback',
    configured: providerIds.length > 0,
    providerIds,
    providers,
    error: providerIds.length === 0 ? configurationError : null,
  }
}

export function inspectCapability<const TDefinition extends SelectedCapabilityDefinition>(
  definition: TDefinition,
  values: EnvCapabilityValues
): SelectedCapabilityInspection<ProviderId<TDefinition>, DeclaredProviderId<TDefinition>>
export function inspectCapability<const TDefinition extends FallbackCapabilityDefinition>(
  definition: TDefinition,
  values: EnvCapabilityValues
): FallbackCapabilityInspection<DeclaredProviderId<TDefinition>>
export function inspectCapability(
  definition: CapabilityDefinition,
  values: EnvCapabilityValues
): SelectedCapabilityInspection | FallbackCapabilityInspection
export function inspectCapability(
  definition: CapabilityDefinition,
  values: EnvCapabilityValues
): SelectedCapabilityInspection | FallbackCapabilityInspection {
  return definition.strategy === 'selected'
    ? inspectSelectedCapability(definition, values)
    : inspectFallbackCapability(definition, values)
}

export function requireCapability<const TDefinition extends SelectedCapabilityDefinition>(
  definition: TDefinition,
  values: EnvCapabilityValues
): Omit<
  SelectedCapabilityInspection<ProviderId<TDefinition>, DeclaredProviderId<TDefinition>>,
  'error' | 'providerId'
> & {
  providerId: ProviderId<TDefinition>
}
export function requireCapability<const TDefinition extends FallbackCapabilityDefinition>(
  definition: TDefinition,
  values: EnvCapabilityValues
): Omit<FallbackCapabilityInspection<DeclaredProviderId<TDefinition>>, 'error'>
export function requireCapability(
  definition: CapabilityDefinition,
  values: EnvCapabilityValues
):
  | (Omit<SelectedCapabilityInspection, 'error' | 'providerId'> & {
      providerId: string
    })
  | Omit<FallbackCapabilityInspection, 'error'> {
  const inspection =
    definition.strategy === 'selected'
      ? inspectSelectedCapability(definition, values)
      : inspectFallbackCapability(definition, values)
  if (inspection.error) throw inspection.error
  if (inspection.strategy === 'selected') {
    const providerId = inspection.providerId
    if (providerId === null) {
      throw new EnvCapabilityConfigurationError(
        definition.id,
        `${definition.label} has no selected provider. Run ${getCapabilitySetupCommand(definition)}.`
      )
    }
    const selected = inspection.providers.find((provider) => provider.id === providerId)
    if (selected && selected.state !== 'ready') {
      const selectedDefinition = definition.providers.find((provider) => provider.id === providerId)
      const strictInspection =
        selected.state === 'absent' && selectedDefinition
          ? inspectRequiredProvider(selectedDefinition, values)
          : selected
      throw new EnvCapabilityConfigurationError(
        definition.id,
        `${definition.label} selects ${providerId}, but that provider is not configured (${providerProblems(strictInspection)}). Run ${getCapabilitySetupCommand(definition)}.`
      )
    }
    return {
      strategy: 'selected',
      providerId,
      providers: inspection.providers,
    }
  }
  if (!inspection.configured) {
    throw new EnvCapabilityConfigurationError(
      definition.id,
      `${definition.label} is not configured. Run ${getCapabilitySetupCommand(definition)}.`
    )
  }
  const { error: _, ...resolution } = inspection
  return resolution
}

function findFieldRequirement(
  requirement: EnvRequirement,
  key: string
): EnvFieldRequirement | null {
  if (requirement.type === 'field') return requirement.key === key ? requirement : null
  for (const child of requirement.requirements) {
    const field = findFieldRequirement(child, key)
    if (field) return field
  }
  return null
}

/** Validates a candidate environment value with the runtime field rule. */
/**
 * Validates one field's input against the provider being configured.
 *
 * `providerId` matters whenever two providers declare the same key with
 * different rules — knowledge embeddings accept different vector widths per
 * family — because without it the first provider declaring the key wins and
 * rejects values that are valid for the one the operator actually chose.
 */
export function validateCapabilityFieldInput(
  definition: CapabilityDefinition,
  key: string,
  value: string,
  providerId?: string
): string | undefined {
  if (!value) return 'required'
  const providers = providerId
    ? definition.providers.filter((provider) => provider.id === providerId)
    : definition.providers
  for (const provider of providers) {
    const field =
      findFieldRequirement(provider.requires, key) ??
      provider.optionalFields?.find((candidate) => candidate.key === key)
    if (!field) continue
    if (!field.validation || isValidEnvCapabilityFieldValue(field.validation, value)) {
      return undefined
    }
    return field.validation.message
  }
  /**
   * A named provider that does not declare the key has nothing to say about it;
   * only a capability that declares it nowhere is a definition error.
   */
  if (providerId) return undefined
  throw new Error(`${definition.label} has no validation definition for ${key}`)
}

export interface WireFallbackOptions<TDefinition extends FallbackCapabilityDefinition, TProvider> {
  definition: TDefinition
  values: EnvCapabilityValues
  factories: FallbackFactories<TDefinition, TProvider>
  shouldFallback?: (error: unknown, providerId: DeclaredProviderId<TDefinition>) => boolean
  onFailure?: (providerId: DeclaredProviderId<TDefinition>, error: unknown) => void
}

export function wireFallback<const TDefinition extends FallbackCapabilityDefinition, TProvider>({
  definition,
  values,
  factories,
  shouldFallback,
  onFailure,
}: WireFallbackOptions<TDefinition, TProvider>) {
  const resolution = inspectCapability(definition, values)
  if (resolution.error) throw resolution.error
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
      operation: (
        provider: TProvider,
        providerId: DeclaredProviderId<TDefinition>
      ) => Promise<TResult>
    ): Promise<TResult> {
      if (resolution.providerIds.length === 0) {
        throw new EnvCapabilityConfigurationError(
          definition.id,
          `${definition.label} is not configured. Run ${getCapabilitySetupCommand(definition)}.`
        )
      }

      const failures: unknown[] = []
      for (const { id: providerId, provider } of providers) {
        try {
          return await operation(provider, providerId)
        } catch (error) {
          if (shouldFallback && !shouldFallback(error, providerId)) throw error
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

export const EMAIL_CAPABILITY = defineCapability({
  strategy: 'fallback',
  id: 'email',
  label: 'Email',
  providers: [
    {
      id: 'resend',
      label: 'Resend',
      activation: { mode: 'any-present', keys: ['RESEND_API_KEY'] },
      requires: envField('RESEND_API_KEY'),
    },
    {
      id: 'ses',
      label: 'Amazon SES',
      activation: { mode: 'any-present', keys: ['AWS_SES_REGION'] },
      requires: envField('AWS_SES_REGION'),
    },
    {
      id: 'smtp',
      label: 'SMTP',
      activation: {
        mode: 'any-present',
        keys: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'],
      },
      requires: allOf(
        envField('SMTP_HOST'),
        envField('SMTP_PORT', {
          validation: {
            kind: 'integer',
            min: 1,
            max: 65535,
            message: 'must be a valid port between 1 and 65535',
          },
        })
      ),
      optionalFields: [envField('SMTP_USER'), envField('SMTP_PASS')],
    },
    {
      id: 'azure',
      label: 'Azure Communication Services',
      activation: {
        mode: 'any-present',
        keys: ['AZURE_ACS_CONNECTION_STRING'],
      },
      requires: envField('AZURE_ACS_CONNECTION_STRING'),
    },
    {
      id: 'gmail',
      label: 'Gmail',
      activation: {
        mode: 'any-present',
        keys: ['GMAIL_CREDENTIALS_JSON', 'GMAIL_SENDER'],
      },
      requires: allOf(
        envField('GMAIL_CREDENTIALS_JSON', {
          validation: {
            kind: 'json-object',
            requiredStringFields: ['client_email', 'private_key'],
            message: 'must be service account JSON with client_email and private_key',
          },
        }),
        envField('GMAIL_SENDER')
      ),
    },
  ],
} as const)

export const STORAGE_CAPABILITY = defineCapability({
  strategy: 'selected',
  id: 'storage',
  label: 'File storage',
  selectorKey: 'STORAGE_PROVIDER',
  whenUnset: 'first-ready',
  defaultProvider: { id: 'local', kind: 'built-in', label: 'Local disk' },
  providers: [
    {
      id: 'azure',
      label: 'Azure Blob Storage',
      activation: {
        mode: 'any-present',
        keys: [
          'AZURE_CONNECTION_STRING',
          'AZURE_ACCOUNT_NAME',
          'AZURE_ACCOUNT_KEY',
          'AZURE_STORAGE_CONTAINER_NAME',
        ],
      },
      requires: allOf(
        envField('AZURE_STORAGE_CONTAINER_NAME'),
        anyOf(
          envField('AZURE_CONNECTION_STRING'),
          allOf(envField('AZURE_ACCOUNT_NAME'), envField('AZURE_ACCOUNT_KEY'))
        )
      ),
    },
    {
      id: 's3',
      label: 'S3',
      activation: {
        mode: 'any-present',
        keys: [
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
      },
      requires: allOf(envField('AWS_REGION'), envField('S3_BUCKET_NAME')),
      pairedFields: [['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']],
      optionalFields: [
        envField('S3_ENDPOINT', {
          validation: {
            kind: 'url',
            protocols: ['http:', 'https:'],
            message: 'must be a valid http:// or https:// URL',
          },
        }),
        envField('S3_FORCE_PATH_STYLE'),
      ],
    },
    {
      id: 'gcs',
      label: 'Google Cloud Storage',
      activation: { mode: 'any-present', keys: ['GCS_BUCKET_NAME'] },
      requires: envField('GCS_BUCKET_NAME'),
      optionalFields: [
        envField('GCS_CREDENTIALS_JSON', {
          validation: {
            kind: 'json-object',
            requiredStringFields: ['client_email', 'private_key'],
            message: 'must be service account JSON with client_email and private_key',
          },
        }),
        envField('GCS_PROJECT_ID'),
      ],
    },
  ],
} as const)

export const SANDBOX_CAPABILITY = defineCapability({
  strategy: 'selected',
  id: 'sandbox',
  label: 'Remote sandbox',
  selectorKey: 'SANDBOX_PROVIDER',
  whenUnset: 'default',
  defaultProvider: { id: 'e2b', kind: 'provider' },
  providers: [
    {
      id: 'e2b',
      label: 'E2B',
      activation: { mode: 'enabled', key: 'E2B_ENABLED' },
      requires: allOf(
        envField('E2B_API_KEY'),
        envField('E2B_FUNCTION_TEMPLATE_ID', {
          validation: {
            kind: 'immutable-e2b-template-ref',
            message: IMMUTABLE_E2B_TEMPLATE_REF_ERROR,
          },
        }),
        envField('E2B_FUNCTION_TEMPLATE_GENERATION', {
          validation: {
            kind: 'sandbox-release-generation',
            message: SANDBOX_RELEASE_GENERATION_ERROR,
          },
        })
      ),
      optionalFields: [
        envField('NEXT_PUBLIC_E2B_ENABLED'),
        envField('NEXT_PUBLIC_SANDBOXES_ENABLED'),
      ],
    },
    {
      id: 'daytona',
      label: 'Daytona',
      activation: {
        mode: 'any-present',
        keys: ['DAYTONA_API_KEY', 'DAYTONA_FUNCTION_SNAPSHOT_ID'],
      },
      requires: allOf(
        envField('DAYTONA_API_KEY'),
        envField('DAYTONA_FUNCTION_SNAPSHOT_ID', {
          validation: {
            kind: 'immutable-daytona-snapshot-ref',
            message: IMMUTABLE_DAYTONA_SNAPSHOT_REF_ERROR,
          },
        })
      ),
      optionalFields: [
        envField('NEXT_PUBLIC_E2B_ENABLED'),
        envField('NEXT_PUBLIC_SANDBOXES_ENABLED'),
      ],
    },
  ],
} as const)

export const ASYNC_JOBS_CAPABILITY = defineCapability({
  strategy: 'selected',
  id: 'jobs',
  label: 'Async jobs',
  whenUnset: 'first-ready',
  defaultProvider: {
    id: 'database',
    kind: 'built-in',
    label: 'Database queue',
  },
  providers: [
    {
      id: 'trigger-dev',
      label: 'Trigger.dev',
      activation: { mode: 'enabled', key: 'TRIGGER_DEV_ENABLED' },
      requires: allOf(envField('TRIGGER_PROJECT_ID'), envField('TRIGGER_SECRET_KEY')),
    },
  ],
} as const)

/** Validates the one provider dependency that cannot be expressed as a field-shape rule. */
function validateRedisProvider(values: EnvCapabilityValues): readonly EnvProviderValidationIssue[] {
  if (!hasValue(values, 'REDIS_URL')) return []
  let redisUrl: URL
  try {
    redisUrl = new URL(String(readValue(values, 'REDIS_URL')))
  } catch {
    return []
  }
  if (
    redisUrl.protocol === 'rediss:' &&
    /^\d+\.\d+\.\d+\.\d+$/.test(redisUrl.hostname) &&
    !hasValue(values, 'REDIS_TLS_SERVERNAME')
  ) {
    return [
      {
        kind: 'missing',
        fields: ['REDIS_TLS_SERVERNAME'],
        message: 'REDIS_TLS_SERVERNAME is required for rediss:// IP addresses',
      },
    ]
  }
  return []
}

export const CACHE_CAPABILITY = defineCapability({
  strategy: 'selected',
  id: 'cache',
  label: 'Cache',
  whenUnset: 'first-ready',
  defaultProvider: { id: 'database', kind: 'built-in', label: 'Postgres' },
  providers: [
    {
      id: 'redis',
      label: 'Redis',
      activation: { mode: 'any-present', keys: ['REDIS_URL'] },
      requires: envField('REDIS_URL', {
        validation: {
          kind: 'url',
          protocols: ['redis:', 'rediss:'],
          message: 'must be a valid redis:// or rediss:// URL',
        },
      }),
      optionalFields: [envField('REDIS_TLS_SERVERNAME')],
      validate: validateRedisProvider,
    },
  ],
} as const)

export const OCR_CAPABILITY = defineCapability({
  strategy: 'selected',
  id: 'knowledge',
  label: 'PDF OCR',
  selectorKey: 'OCR_PROVIDER',
  whenUnset: 'first-ready',
  defaultProvider: { id: 'local', kind: 'built-in', label: 'Local parser' },
  providers: [
    {
      id: 'azure-mistral',
      label: 'Azure Mistral OCR',
      activation: {
        mode: 'any-present',
        keys: ['OCR_AZURE_API_KEY', 'OCR_AZURE_ENDPOINT', 'OCR_AZURE_MODEL_NAME'],
      },
      requires: allOf(
        envField('OCR_AZURE_API_KEY'),
        envField('OCR_AZURE_ENDPOINT', {
          validation: {
            kind: 'url',
            protocols: ['http:', 'https:'],
            message: 'must be a valid HTTP(S) URL',
          },
        }),
        envField('OCR_AZURE_MODEL_NAME')
      ),
    },
    {
      id: 'mistral',
      label: 'Mistral OCR',
      activation: { mode: 'any-present', keys: ['MISTRAL_API_KEY'] },
      requires: envField('MISTRAL_API_KEY'),
    },
  ],
} as const)

/**
 * Model families a knowledge base can be indexed with.
 *
 * `KB_EMBEDDING_MODEL` names a model rather than a provider, so the family is
 * read off the id. The match has to be exactly as strict as the runtime's,
 * which keeps the configured id only when it is one a knowledge base can
 * actually use and otherwise falls back to `text-embedding-3-small`: a looser
 * rule here reports a family as configured that the runtime will not use, so a
 * deployment holding only that family's credentials passes its status check and
 * then fails every embedding call. So no prefix matching for the catalogued
 * families and no case folding — `Gemini-Embedding-001` is not a model the
 * runtime accepts, and neither is `gemini-embedding-999`.
 *
 * Ollama is the one open-ended family: its models are whatever the operator
 * pulled, so any id under the exact `ollama/` prefix counts, matching
 * `isOllamaEmbeddingModel`.
 *
 * This mirrors `apps/sim/lib/embeddings/catalog.ts`, which packages cannot
 * import. `apps/sim/lib/embeddings/knowledge-embedding-family.test.ts` pins the
 * two together, including for ids the runtime rejects.
 */
export type KnowledgeEmbeddingFamily = 'openai' | 'gemini' | 'ollama'

const OLLAMA_EMBEDDING_MODEL_PREFIX = 'ollama/'

/**
 * Widths each knowledge-base-eligible model can be indexed at, as the app
 * catalog defines them. Duplicated here because packages cannot import the
 * catalog; the parity test pins both halves, widths included.
 */
const KB_EMBEDDING_MODEL_WIDTHS: Readonly<Record<string, readonly number[]>> = {
  'text-embedding-3-small': [1536, 1024, 768],
  'text-embedding-3-large': [3072, 1536, 1024, 768],
  'gemini-embedding-001': [3072, 1536, 768],
}

/** Knowledge-base-eligible Gemini model ids, as the app catalog defines them. */
const GEMINI_KB_EMBEDDING_MODELS: readonly string[] = ['gemini-embedding-001']

/**
 * Rejects a width the *selected model* cannot emit, which the per-field pattern
 * cannot: that pattern is the union across a family, so `text-embedding-3-small`
 * at 3,072 satisfies it while the runtime falls back to 1,536 with a warning.
 * A validation that passes for a configuration the runtime silently overrides is
 * worse than none, so the two are checked together here.
 */
function validateEmbeddingModelWidth(
  values: EnvCapabilityValues
): readonly EnvProviderValidationIssue[] {
  const model = String(readValue(values, 'KB_EMBEDDING_MODEL') ?? '')
  const rawWidth = readValue(values, 'EMBEDDING_OUTPUT_DIMS')
  if (!hasValue(values, 'EMBEDDING_OUTPUT_DIMS')) return []

  const widths = KB_EMBEDDING_MODEL_WIDTHS[model]
  if (!widths) return []
  if (widths.includes(Number(String(rawWidth).trim()))) return []
  return [
    {
      kind: 'invalid',
      fields: ['EMBEDDING_OUTPUT_DIMS'],
      message: `EMBEDDING_OUTPUT_DIMS must be one of ${widths.join(', ')} for ${model}`,
    },
  ]
}

export function knowledgeEmbeddingFamily(values: EnvCapabilityValues): KnowledgeEmbeddingFamily {
  /**
   * Read raw, not trimmed: the runtime looks the value up exactly as configured,
   * so ` gemini-embedding-001 ` is a model it rejects. Trimming here would
   * report Gemini as configured for a value that routes to OpenAI's default.
   */
  const model = String(readValue(values, 'KB_EMBEDDING_MODEL') ?? '')
  if (model.startsWith(OLLAMA_EMBEDDING_MODEL_PREFIX)) {
    return model.length > OLLAMA_EMBEDDING_MODEL_PREFIX.length ? 'ollama' : 'openai'
  }
  if (GEMINI_KB_EMBEDDING_MODELS.includes(model)) return 'gemini'
  return 'openai'
}

const embeddingFamilyIs =
  (family: KnowledgeEmbeddingFamily) =>
  (values: EnvCapabilityValues): boolean =>
    knowledgeEmbeddingFamily(values) === family

/**
 * `EMBEDDING_OUTPUT_DIMS` must name a width the `embedding` table has a column
 * for *and* one the selected family can emit — a value that fails either test
 * falls back at runtime with only a log line, so it is caught here instead.
 *
 * The accepted set is therefore per family: OpenAI's models reduce to 768 and
 * up, Gemini's to 768, 1536, or 3072, and an Ollama model can be any of the
 * five (384 is only reachable through a local model such as all-minilm).
 */
function embeddingOutputDimsField(widths: readonly number[]) {
  return envField('EMBEDDING_OUTPUT_DIMS', {
    validation: {
      kind: 'pattern',
      pattern: new RegExp(`^(${widths.join('|')})$`),
      message: `must be one of ${widths.join(', ')}`,
    },
  })
}

const OPENAI_EMBEDDING_WIDTHS = [768, 1024, 1536, 3072] as const
const GEMINI_EMBEDDING_WIDTHS = [768, 1536, 3072] as const
const OLLAMA_EMBEDDING_WIDTHS = [384, 768, 1024, 1536, 3072] as const

/**
 * Which credential serves knowledge-base embeddings.
 *
 * `KB_EMBEDDING_MODEL` picks the family and the family's transports are tried in
 * order, so the providers below are gated on the selected family as well as on
 * their own keys: a Gemini key does not make Gemini a fallback for an OpenAI
 * model, and it does not become one just because it is present. Only the OpenAI
 * family has more than one transport, and it is the only one `wireFallback`
 * ever chains — the others are reached directly by `embed()`.
 */
export const KNOWLEDGE_EMBEDDINGS_CAPABILITY = defineCapability({
  strategy: 'fallback',
  id: 'knowledge-embeddings',
  label: 'Knowledge embeddings',
  providers: [
    {
      id: 'azure-openai',
      label: 'Azure OpenAI',
      activation: {
        mode: 'any-present',
        keys: ['AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_API_VERSION'],
      },
      activeWhen: embeddingFamilyIs('openai'),
      requires: allOf(
        envField('AZURE_OPENAI_API_KEY'),
        envField('AZURE_OPENAI_ENDPOINT', {
          validation: {
            kind: 'url',
            protocols: ['http:', 'https:'],
            message: 'must be a valid HTTP(S) URL',
          },
        }),
        envField('AZURE_OPENAI_API_VERSION')
      ),
      optionalFields: [
        envField('KB_OPENAI_MODEL_NAME'),
        envField('KB_EMBEDDING_MODEL'),
        embeddingOutputDimsField(OPENAI_EMBEDDING_WIDTHS),
      ],
      validate: validateEmbeddingModelWidth,
    },
    {
      id: 'openai',
      label: 'OpenAI',
      activation: {
        mode: 'any-present',
        keys: ['OPENAI_API_KEY', 'OPENAI_API_KEY_1', 'OPENAI_API_KEY_2', 'OPENAI_API_KEY_3'],
      },
      activeWhen: embeddingFamilyIs('openai'),
      requires: anyOf(
        envField('OPENAI_API_KEY'),
        envField('OPENAI_API_KEY_1'),
        envField('OPENAI_API_KEY_2'),
        envField('OPENAI_API_KEY_3')
      ),
      optionalFields: [
        envField('KB_EMBEDDING_MODEL'),
        embeddingOutputDimsField(OPENAI_EMBEDDING_WIDTHS),
      ],
      validate: validateEmbeddingModelWidth,
    },
    {
      id: 'openrouter',
      label: 'OpenRouter',
      activation: { mode: 'any-present', keys: ['OPENROUTER_API_KEY'] },
      activeWhen: embeddingFamilyIs('openai'),
      requires: envField('OPENROUTER_API_KEY'),
      /**
       * The same optional fields as the other OpenAI-family transports. Without
       * them a deployment whose only transport is OpenRouter reports an
       * unsupported width as configured, because no active provider validates it.
       */
      optionalFields: [
        envField('KB_EMBEDDING_MODEL'),
        embeddingOutputDimsField(OPENAI_EMBEDDING_WIDTHS),
      ],
      validate: validateEmbeddingModelWidth,
    },
    {
      id: 'gemini',
      label: 'Google Gemini',
      activation: {
        mode: 'any-present',
        keys: ['GEMINI_API_KEY', 'GEMINI_API_KEY_1', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3'],
      },
      activeWhen: embeddingFamilyIs('gemini'),
      requires: allOf(
        anyOf(
          envField('GEMINI_API_KEY'),
          envField('GEMINI_API_KEY_1'),
          envField('GEMINI_API_KEY_2'),
          envField('GEMINI_API_KEY_3')
        ),
        envField('KB_EMBEDDING_MODEL')
      ),
      optionalFields: [embeddingOutputDimsField(GEMINI_EMBEDDING_WIDTHS)],
      validate: validateEmbeddingModelWidth,
    },
    {
      /**
       * Activated by `KB_EMBEDDING_MODEL` as well as `OLLAMA_URL`, so an
       * operator who names an Ollama model but has not pointed Sim at a server
       * is told which field is missing rather than that nothing is configured.
       */
      id: 'ollama',
      label: 'Ollama',
      activation: { mode: 'any-present', keys: ['OLLAMA_URL', 'KB_EMBEDDING_MODEL'] },
      activeWhen: embeddingFamilyIs('ollama'),
      requires: allOf(
        envField('OLLAMA_URL', {
          validation: {
            kind: 'url',
            protocols: ['http:', 'https:'],
            message: 'must be a valid HTTP(S) URL',
          },
        }),
        /**
         * Constrained to the routing prefix, which is what makes it an Ollama
         * model at all. It also stops the setup flow carrying a model from
         * another family forward when an existing install switches to Ollama.
         */
        envField('KB_EMBEDDING_MODEL', {
          validation: {
            kind: 'pattern',
            pattern: /^ollama\/.+/,
            message: 'must name a model on your Ollama server, as ollama/<model>',
          },
        })
      ),
      optionalFields: [embeddingOutputDimsField(OLLAMA_EMBEDDING_WIDTHS)],
    },
  ],
} as const)

export const OAUTH_CLIENT_CAPABILITIES = {
  google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  x: ['X_CLIENT_ID', 'X_CLIENT_SECRET'],
  tiktok: ['TIKTOK_CLIENT_ID', 'TIKTOK_CLIENT_SECRET'],
  confluence: ['CONFLUENCE_CLIENT_ID', 'CONFLUENCE_CLIENT_SECRET'],
  jira: ['JIRA_CLIENT_ID', 'JIRA_CLIENT_SECRET'],
  calcom: ['CALCOM_CLIENT_ID'],
  airtable: ['AIRTABLE_CLIENT_ID', 'AIRTABLE_CLIENT_SECRET'],
  bitbucket: ['BITBUCKET_CLIENT_ID', 'BITBUCKET_CLIENT_SECRET'],
  'github-repositories': ['GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET'],
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

/** Single registry consumed by runtime status and environment-source detection. */
export const ENV_CAPABILITIES = [
  EMAIL_CAPABILITY,
  STORAGE_CAPABILITY,
  SANDBOX_CAPABILITY,
  ASYNC_JOBS_CAPABILITY,
  CACHE_CAPABILITY,
  OCR_CAPABILITY,
  KNOWLEDGE_EMBEDDINGS_CAPABILITY,
] as const

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
    ...ENV_CAPABILITIES.flatMap(capabilityKeys),
    'COPILOT_API_KEY',
    'EMAIL_VERIFICATION_ENABLED',
    'NEXT_PUBLIC_CHAT_DISABLED',
    'NEXT_PUBLIC_E2B_ENABLED',
    'NEXT_PUBLIC_SANDBOXES_ENABLED',
    'SIM_AGENT_API_URL',
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
  'google-chat',
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
  'microsoft-word',
])

export function resolveOAuthClientCapabilityId(serviceId: string): OAuthClientCapabilityId | null {
  const normalized = serviceId.toLowerCase().replace(/_/g, '-')
  if (GOOGLE_OAUTH_SERVICES.has(normalized)) return 'google'
  if (MICROSOFT_OAUTH_SERVICES.has(normalized)) return 'microsoft'
  if (normalized === 'zoho') return 'zoho-desk'
  // ServiceDesk Plus Cloud authenticates through Zoho. Scopes are chosen per
  // authorization request rather than per API-console client, so the same
  // registered Zoho client serves both products and is configured by the same
  // env pair — without this alias the integration is silently dropped.
  if (normalized === 'manageengine-sdp') return 'zoho-desk'
  // One consumer key serves both Salesforce login hosts, so the sandbox provider
  // is configured by the same env pair — without this alias it is silently dropped.
  if (normalized === 'salesforce-sandbox') return 'salesforce'
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
      setupCommand: `npx sim-setup add integration ${providerId}`,
    }
  }

  const present = fields.filter((key) => readOAuthClientFieldValue(values, key) !== null)
  return {
    state: present.length === 0 ? 'absent' : present.length === fields.length ? 'ready' : 'partial',
    missingFields: fields.filter((key) => readOAuthClientFieldValue(values, key) === null),
    setupCommand: `npx sim-setup add integration ${providerId}`,
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
