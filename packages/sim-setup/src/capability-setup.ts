/**
 * Generic prompt rendering and environment transitions for the CLI setup catalog.
 *
 * @packageDocumentation
 */
import {
  EnvCapabilityConfigurationError,
  type EnvCapabilityValue,
  type EnvCapabilityValues,
  getProviderFields,
  hasEnvCapabilityValue,
  inspectCapability,
  isTruthyEnvCapabilityValue,
  validateCapabilityFieldInput,
} from '@sim/deployment-config/env-capabilities'
import {
  type CapabilitySetupDefinition,
  matchesSetupCondition,
  type SetupCondition,
  type SetupHint,
  type SetupPrompt,
} from './capability-config'
import * as p from './prompter'

export interface CapabilitySetupContext {
  containerized: boolean
}

export interface EnvCapabilitySetupTransition {
  values: Record<string, string>
  remove: readonly string[]
}

interface ResolvedSetupOption {
  id: string
  label: string
  hint?: SetupHint
  kind: 'provider' | 'default' | 'action'
  providerId?: string
  env: Readonly<Record<string, string>>
  prompts: readonly SetupPrompt[]
  currentWhen?: SetupCondition
}

interface PromptState {
  setup: CapabilitySetupDefinition
  optionId: string
  currentValues: ReadonlyMap<string, string>
  values: Record<string, string>
}

const SKIP_OPTION_ID = '__skip-capability-setup__'

/** Stages a capability transition into a larger setup run without losing prompt context. */
export function stageCapabilitySetupTransition(
  currentValues: Map<string, string>,
  values: Record<string, string>,
  remove: Set<string>,
  transition: EnvCapabilitySetupTransition
): void {
  for (const key of transition.remove) {
    currentValues.delete(key)
    Reflect.deleteProperty(values, key)
    remove.add(key)
  }
  for (const [key, value] of Object.entries(transition.values)) {
    currentValues.set(key, value)
    values[key] = value
    remove.delete(key)
  }
}

function resolveHint(
  hint: SetupHint | undefined,
  context: CapabilitySetupContext
): string | undefined {
  if (!hint || typeof hint === 'string') return hint
  return context.containerized ? hint.containerized : hint.development
}

/** Adds the standard status marker without discarding an option's explanatory hint. */
export function markCurrentlyUsed(hint: string | undefined, current: boolean): string | undefined {
  if (!current) return hint
  return hint ? `${hint} · Currently used` : 'Currently used'
}

function promptKeys(prompts: readonly SetupPrompt[] = []): string[] {
  return prompts.flatMap((prompt) => {
    if (prompt.type === 'field' || prompt.type === 'confirm') return [prompt.key]
    return prompt.options.flatMap((option) => [
      ...Object.keys(option.env ?? {}),
      ...promptKeys(option.prompts),
    ])
  })
}

function providerSetupFields(
  setup: CapabilitySetupDefinition,
  providerId: string
): readonly string[] {
  const provider = setup.definition.providers.find((candidate) => candidate.id === providerId)
  if (!provider) throw new Error(`Capability ${setup.definition.id} has no provider ${providerId}`)
  const providerSetup = setup.providers[providerId]
  if (!providerSetup) throw new Error(`Setup ${setup.definition.id} has no provider ${providerId}`)
  return [
    ...(provider.activation.mode === 'enabled' ? [provider.activation.key] : []),
    ...Object.keys(providerSetup.env ?? {}),
    ...promptKeys(providerSetup.prompts),
  ]
}

/** Returns fields the setup flow writes or prompts for, including inferred selectors and flags. */
export function getCapabilitySetupFields(setup: CapabilitySetupDefinition): readonly string[] {
  return [
    ...new Set([
      ...(setup.definition.strategy === 'selected' && setup.definition.selectorKey
        ? [setup.definition.selectorKey]
        : []),
      ...setup.definition.providers.flatMap((provider) =>
        provider.activation.mode === 'enabled' ? [provider.activation.key] : []
      ),
      ...Object.entries(setup.providers).flatMap(([providerId]) =>
        providerSetupFields(setup, providerId)
      ),
      ...Object.values(setup.actions).flatMap((action) => Object.keys(action.env ?? {})),
    ]),
  ]
}

/** Expands the runtime providers and CLI-only actions into renderable options. */
export function getCapabilitySetupOptions(
  setup: CapabilitySetupDefinition
): readonly ResolvedSetupOption[] {
  const definition = setup.definition
  const options: ResolvedSetupOption[] = definition.providers.map((provider) => {
    const providerSetup = setup.providers[provider.id]
    if (!providerSetup) throw new Error(`Setup ${definition.id} has no provider ${provider.id}`)
    return {
      id: provider.id,
      label: provider.label,
      hint: providerSetup.hint,
      kind: 'provider',
      providerId: provider.id,
      env: providerSetup.env ?? {},
      prompts: providerSetup.prompts,
      currentWhen: providerSetup.currentWhen,
    }
  })

  if (definition.strategy === 'selected' && definition.defaultProvider.kind === 'built-in') {
    options.push({
      id: definition.defaultProvider.id,
      label: definition.defaultProvider.label,
      hint: setup.defaultOption?.hint,
      kind: 'default',
      env: {},
      prompts: [],
    })
  }

  for (const [id, action] of Object.entries(setup.actions)) {
    options.push({
      id,
      label: action.label,
      hint: action.hint,
      kind: 'action',
      env: action.env ?? {},
      prompts: [],
      currentWhen: action.currentWhen,
    })
  }

  const byId = new Map(options.map((option) => [option.id, option]))
  return setup.optionOrder.map((id) => {
    const option = byId.get(String(id))
    if (!option) throw new Error(`Setup ${definition.id} option order references ${String(id)}`)
    return option
  })
}

/** Resolves the setup option representing the effective current configuration, if one exists. */
export function resolveCurrentCapabilitySetupOptionId(
  setup: CapabilitySetupDefinition,
  values: EnvCapabilityValues
): string | undefined {
  const options = getCapabilitySetupOptions(setup)
  const explicitAction = options.find(
    (option) =>
      option.kind === 'action' &&
      option.currentWhen &&
      matchesSetupCondition(option.currentWhen, values)
  )
  if (explicitAction) return explicitAction.id

  const inspection = inspectCapability(setup.definition, values)
  const selectedProviderId =
    inspection.strategy === 'selected'
      ? (inspection.providerId ?? inspection.providers.find((provider) => provider.active)?.id)
      : (inspection.providerIds[0] ?? inspection.providers.find((provider) => provider.active)?.id)
  if (selectedProviderId) {
    const provider = options.find(
      (option) =>
        option.kind === 'provider' &&
        option.providerId === selectedProviderId &&
        (!option.currentWhen || matchesSetupCondition(option.currentWhen, values))
    )
    if (provider) return provider.id
  }

  if (
    setup.definition.strategy === 'selected' &&
    setup.definition.defaultProvider.kind === 'built-in'
  ) {
    return setup.definition.defaultProvider.id
  }

  const firstAction = options.find((option) => option.kind === 'action')
  if (firstAction) return firstAction.id
  if (options.length === 0) {
    throw new Error(`Capability ${setup.definition.id} has no setup options`)
  }
  return undefined
}

/** Applies selector and activation inference to the CLI-entered values. */
export function getCapabilitySetupDraftValues(
  setup: CapabilitySetupDefinition,
  optionId: string,
  promptedValues: Readonly<Record<string, string>>
): Record<string, string> {
  const definition = setup.definition
  const option = getCapabilitySetupOptions(setup).find((candidate) => candidate.id === optionId)
  if (!option) throw new Error(`Capability ${definition.id} has no setup option ${optionId}`)

  const values: Record<string, string> = { ...option.env }
  if (definition.strategy === 'selected' && definition.selectorKey) {
    if (option.providerId) values[definition.selectorKey] = option.providerId
    else if (option.kind === 'default' && option.id === definition.defaultProvider.id) {
      values[definition.selectorKey] = option.id
    }
  }
  for (const provider of definition.providers) {
    if (provider.activation.mode !== 'enabled') continue
    values[provider.activation.key] = provider.id === option.providerId ? 'true' : 'false'
  }
  Object.assign(values, promptedValues)
  return values
}

function copyValues(values: EnvCapabilityValues): Record<string, EnvCapabilityValue> {
  return values instanceof Map
    ? Object.fromEntries(values)
    : { ...(values as Readonly<Record<string, EnvCapabilityValue>>) }
}

function fieldsToReplace(
  setup: CapabilitySetupDefinition,
  option: ResolvedSetupOption
): readonly string[] {
  if (setup.definition.strategy === 'fallback' && option.providerId) {
    return providerSetupFields(setup, option.providerId)
  }
  const selectedProviderFields = new Set(
    setup.definition.providers
      .filter((provider) => provider.id === option.providerId)
      .flatMap(getProviderFields)
  )
  const inactiveProviderFields = setup.definition.providers
    .filter((provider) => provider.id !== option.providerId)
    .flatMap(getProviderFields)
    .filter((field) => !selectedProviderFields.has(field))
  return [...new Set([...getCapabilitySetupFields(setup), ...inactiveProviderFields])]
}

function proposedCapabilitySetupValues(
  setup: CapabilitySetupDefinition,
  option: ResolvedSetupOption,
  values: Readonly<Record<string, string>>,
  currentValues: EnvCapabilityValues
): Record<string, EnvCapabilityValue> {
  const proposed = copyValues(currentValues)
  for (const key of fieldsToReplace(setup, option)) Reflect.deleteProperty(proposed, key)
  Object.assign(proposed, values)
  return proposed
}

/** Returns provider requirements discovered after earlier prompts have been answered. */
export function getCapabilitySetupProviderMissingFields(
  setup: CapabilitySetupDefinition,
  optionId: string,
  promptedValues: Readonly<Record<string, string>>,
  currentValues: EnvCapabilityValues
): readonly string[] {
  const option = getCapabilitySetupOptions(setup).find((candidate) => candidate.id === optionId)
  if (!option?.providerId) return []
  const values = getCapabilitySetupDraftValues(setup, optionId, promptedValues)
  const inspection = inspectCapability(
    setup.definition,
    proposedCapabilitySetupValues(setup, option, values, currentValues)
  )
  return (
    inspection.providers.find((provider) => provider.id === option.providerId)?.missingFields ?? []
  )
}

/** Builds and validates the complete environment transition for one setup option. */
export function buildCapabilitySetupTransition(
  setup: CapabilitySetupDefinition,
  optionId: string,
  promptedValues: Readonly<Record<string, string>>,
  currentValues: EnvCapabilityValues
): EnvCapabilitySetupTransition {
  const definition = setup.definition
  const option = getCapabilitySetupOptions(setup).find((candidate) => candidate.id === optionId)
  if (!option) throw new Error(`Capability ${definition.id} has no setup option ${optionId}`)

  const values = getCapabilitySetupDraftValues(setup, optionId, promptedValues)
  const ownedFields = getCapabilitySetupFields(setup)
  const unexpected = Object.keys(values).filter((key) => !ownedFields.includes(key))
  if (unexpected.length > 0) {
    throw new Error(
      `Capability ${definition.id} setup produced unowned fields: ${unexpected.join(', ')}`
    )
  }

  const replacedFields = fieldsToReplace(setup, option)
  const remove = replacedFields.filter((key) => !Object.hasOwn(values, key))
  const proposed = proposedCapabilitySetupValues(setup, option, values, currentValues)
  const inspection = inspectCapability(definition, proposed)
  if (inspection.error) throw inspection.error

  if (option.providerId) {
    const provider = inspection.providers.find((candidate) => candidate.id === option.providerId)
    if (!provider || provider.state !== 'ready') {
      throw new EnvCapabilityConfigurationError(
        definition.id,
        `${definition.label} setup option ${option.id} did not configure ${option.providerId}`
      )
    }
    if (inspection.strategy === 'selected' && inspection.providerId !== option.providerId) {
      throw new EnvCapabilityConfigurationError(
        definition.id,
        `${definition.label} setup selected ${inspection.providerId ?? 'nothing'} instead of ${option.providerId}`
      )
    }
  } else {
    const activeProvider = inspection.providers.find((provider) => provider.active)
    if (activeProvider) {
      throw new EnvCapabilityConfigurationError(
        definition.id,
        `${definition.label} setup option ${option.id} left ${activeProvider.id} active`
      )
    }
  }

  return { values, remove }
}

function proposedPromptValues(state: PromptState): EnvCapabilityValues {
  const option = getCapabilitySetupOptions(state.setup).find(
    (candidate) => candidate.id === state.optionId
  )
  if (!option) {
    throw new Error(`Capability ${state.setup.definition.id} has no setup option ${state.optionId}`)
  }
  return proposedCapabilitySetupValues(
    state.setup,
    option,
    getCapabilitySetupDraftValues(state.setup, state.optionId, state.values),
    state.currentValues
  )
}

function shouldRenderPrompt(prompt: SetupPrompt, state: PromptState): boolean {
  if (!prompt.when) return true
  if (prompt.when.kind === 'provider-missing-field') {
    return getCapabilitySetupProviderMissingFields(
      state.setup,
      state.optionId,
      state.values,
      state.currentValues
    ).includes(prompt.when.key)
  }
  return matchesSetupCondition(prompt.when, proposedPromptValues(state))
}

/** Formats current-value status without ever rendering the configured value. */
export function formatCapabilitySetupFieldMessage(
  prompt: Extract<SetupPrompt, { type: 'field' }>,
  current: boolean,
  keepExisting = false
): string {
  const label = prompt.message ?? prompt.key
  const status = current ? ' (Currently used)' : ''
  const hint = prompt.hint ? ` — ${prompt.hint}` : ''
  const preservation = current && keepExisting ? '; leave empty to keep it' : ''
  return `${label}${status}${hint}${preservation}`
}

async function promptField(
  prompt: Extract<SetupPrompt, { type: 'field' }>,
  state: PromptState
): Promise<void> {
  const existing = state.currentValues.get(prompt.key)
  const current = hasEnvCapabilityValue(state.currentValues, prompt.key)
  const draft = getCapabilitySetupDraftValues(state.setup, state.optionId, state.values)
  const initialValue = existing ?? draft[prompt.key] ?? prompt.defaultValue
  const validate = (value: string): string | undefined => {
    if (!value) return prompt.required && !existing ? 'required' : undefined
    return prompt.validate
      ? validateCapabilityFieldInput(state.setup.definition, prompt.key, value, state.optionId)
      : undefined
  }

  let value: string
  if (prompt.input === 'secret') {
    value = await p.password({
      message: formatCapabilitySetupFieldMessage(prompt, current, true),
      validate,
    })
    if (!value && existing) value = existing
  } else {
    value = await p.text({
      message: formatCapabilitySetupFieldMessage(prompt, current),
      initialValue,
      defaultValue: initialValue ? undefined : prompt.defaultValue,
      validate,
    })
  }

  if (value) state.values[prompt.key] = value
  else Reflect.deleteProperty(state.values, prompt.key)
}

async function renderPrompts(prompts: readonly SetupPrompt[], state: PromptState): Promise<void> {
  for (const prompt of prompts) {
    if (!shouldRenderPrompt(prompt, state)) continue
    if (prompt.type === 'field') {
      await promptField(prompt, state)
      continue
    }
    if (prompt.type === 'confirm') {
      const proposed = proposedPromptValues(state)
      const current = hasEnvCapabilityValue(state.currentValues, prompt.key)
      const enabled = await p.confirm({
        message: `${prompt.message}${current ? ' (Currently used)' : ''}`,
        initialValue: hasEnvCapabilityValue(proposed, prompt.key)
          ? isTruthyEnvCapabilityValue(proposed, prompt.key)
          : (prompt.defaultValue ?? false),
      })
      state.values[prompt.key] = enabled ? 'true' : 'false'
      continue
    }

    const currentOption = prompt.options.find(
      (option) =>
        option.currentWhen && matchesSetupCondition(option.currentWhen, state.currentValues)
    )
    const initialOption = currentOption ?? prompt.options[0]
    if (!initialOption) throw new Error(`Setup choice ${prompt.id} has no options`)
    const selectedId = await p.select({
      message: prompt.message,
      options: prompt.options.map((option) => ({
        value: option.id,
        label: option.label,
        hint: markCurrentlyUsed(option.hint, option.id === currentOption?.id),
      })),
      initialValue: initialOption.id,
    })
    const selected = prompt.options.find((option) => option.id === selectedId)
    if (!selected) {
      throw new Error(`Setup choice ${prompt.id} returned unknown option ${selectedId}`)
    }
    Object.assign(state.values, selected.env ?? {})
    await renderPrompts(selected.prompts ?? [], state)
  }
}

async function promptSelectedCapabilitySetup(
  setup: CapabilitySetupDefinition,
  selected: ResolvedSetupOption,
  currentValues: ReadonlyMap<string, string>
): Promise<EnvCapabilitySetupTransition> {
  const state: PromptState = {
    setup,
    optionId: selected.id,
    currentValues,
    values: {},
  }
  await renderPrompts(selected.prompts, state)
  return buildCapabilitySetupTransition(setup, selected.id, state.values, currentValues)
}

/** Renders a CLI-owned capability setup and returns its validated environment transition. */
export async function promptCapabilitySetup(
  setup: CapabilitySetupDefinition,
  currentValues: ReadonlyMap<string, string>,
  context: CapabilitySetupContext
): Promise<EnvCapabilitySetupTransition> {
  const options = getCapabilitySetupOptions(setup)
  const currentOptionId = resolveCurrentCapabilitySetupOptionId(setup, currentValues)
  const selectedOptionId = await p.select({
    message: setup.message,
    options: options.map((option) => ({
      value: option.id,
      label: option.label,
      hint: markCurrentlyUsed(resolveHint(option.hint, context), option.id === currentOptionId),
    })),
    initialValue: currentOptionId,
  })
  const selected = options.find((option) => option.id === selectedOptionId)
  if (!selected) {
    throw new Error(
      `Capability ${setup.definition.id} returned unknown setup option ${selectedOptionId}`
    )
  }

  return promptSelectedCapabilitySetup(setup, selected, currentValues)
}

/** Offers capability providers while allowing the user to leave configuration unchanged. */
export async function promptOptionalCapabilitySetup(
  setup: CapabilitySetupDefinition,
  currentValues: ReadonlyMap<string, string>,
  context: CapabilitySetupContext,
  skipHint: string
): Promise<EnvCapabilitySetupTransition | null> {
  const options = getCapabilitySetupOptions(setup)
  if (options.some((option) => option.id === SKIP_OPTION_ID)) {
    throw new Error(`Capability ${setup.definition.id} uses reserved option ${SKIP_OPTION_ID}`)
  }
  const currentOptionId = resolveCurrentCapabilitySetupOptionId(setup, currentValues)
  const selectedOptionId = await p.select({
    message: setup.message,
    options: [
      ...options.map((option) => ({
        value: option.id,
        label: option.label,
        hint: markCurrentlyUsed(resolveHint(option.hint, context), option.id === currentOptionId),
      })),
      {
        value: SKIP_OPTION_ID,
        label: 'Not now',
        hint: currentOptionId ? 'leave the current configuration unchanged' : skipHint,
      },
    ],
    initialValue: currentOptionId ?? options[0]?.id,
  })
  if (selectedOptionId === SKIP_OPTION_ID) return null

  const selected = options.find((option) => option.id === selectedOptionId)
  if (!selected) {
    throw new Error(
      `Capability ${setup.definition.id} returned unknown setup option ${selectedOptionId}`
    )
  }
  return promptSelectedCapabilitySetup(setup, selected, currentValues)
}
