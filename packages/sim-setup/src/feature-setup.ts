import {
  LLM_KEY_POOLS,
  OAUTH_CLIENT_CAPABILITIES,
  resolveOAuthClientCapabilityId,
} from '@sim/deployment-config/env-capabilities'
import {
  getCapabilitySetup,
  getOAuthClientSetupFields,
  SETUP_FEATURES,
  type SetupFeatureId,
} from './capability-config'
import { promptCapabilitySetup } from './capability-setup'
import { type ConfigurationSource, discoverConfigurationSources } from './configuration-sources'
import { type EnvTarget, reconcileEnvValues } from './env-files'
import * as p from './prompter'
import { theme } from './theme'

function isSetupFeatureId(value: string): value is SetupFeatureId {
  return SETUP_FEATURES.some((feature) => feature.id === value)
}

async function setupIntegration(
  requestedId: string | undefined,
  vars: Map<string, string>
): Promise<Record<string, string>> {
  if (!requestedId) {
    throw new Error('Missing integration id. Example: npx sim-setup add integration slack')
  }
  const providerId = resolveOAuthClientCapabilityId(requestedId)
  if (!providerId) {
    throw new Error(
      `Unknown OAuth integration "${requestedId}". Expected one of: ${Object.keys(OAUTH_CLIENT_CAPABILITIES).join(', ')}`
    )
  }
  const fields = getOAuthClientSetupFields(providerId)

  const values: Record<string, string> = {}
  for (const field of fields) {
    const existing = vars.get(field.key)
    if (field.input === 'secret') {
      const value = await p.password({
        message: existing ? `${field.key} (Currently used); leave empty to keep it` : field.key,
        validate: (candidate) => (candidate || existing ? undefined : 'required'),
      })
      const resolved = value || existing
      if (!resolved) throw new Error(`${field.key} was not provided`)
      values[field.key] = resolved
    } else {
      values[field.key] = await p.text({
        message: `${field.key}${existing ? ' (Currently used)' : ''}`,
        initialValue: existing,
        validate: (candidate) => (candidate ? undefined : 'required'),
      })
    }
  }
  p.log.info(`Configured the ${providerId} OAuth client.`)
  return values
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

async function setupLlm(vars: Map<string, string>): Promise<LlmSetupResult> {
  const currentProvider = Object.entries(LLM_KEY_POOLS).find(([, pool]) =>
    [...pool.keys, ...('fallbackKey' in pool ? [pool.fallbackKey] : [])].some((key) =>
      vars.has(key)
    )
  )?.[0] as LlmKeyPoolId | undefined
  const provider = await p.select<LlmKeyPoolId>({
    message: 'LLM key pool?',
    options: Object.keys(LLM_KEY_POOLS).map((id) => ({
      value: id as LlmKeyPoolId,
      label: id,
      hint: id === currentProvider ? 'Currently used' : undefined,
    })),
    initialValue: currentProvider,
  })
  const pool = LLM_KEY_POOLS[provider]
  const keys = pool.keys
  const values: Record<string, string> = {}
  for (const [index, key] of keys.entries()) {
    const legacyKey = index === 0 && 'fallbackKey' in pool ? pool.fallbackKey : undefined
    const existingKey = vars.has(key) ? key : legacyKey
    const existing = existingKey ? vars.get(existingKey) : undefined
    const value = await p.password({
      message: existing
        ? `${key} (${existingKey} is currently used); leave empty to keep it`
        : `${key}${index === 0 ? '' : ' (empty to finish)'}`,
      validate:
        index === 0 ? (candidate) => (candidate || existing ? undefined : 'required') : undefined,
    })
    const resolved = value || existing
    if (!resolved) break
    values[key] = resolved
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
    throw new Error('No Sim configuration was detected. Run npx sim-setup first.')
  }

  const managed = sources.filter((source) => source.managedByCurrentCheckout)
  if (managed.length === 0) {
    throw new Error(
      'No effective configuration is safely writable by this checkout. Process overrides, higher-precedence development env files, external Compose projects, and Helm releases must be updated at their source. Run npx sim-setup config for the detected sources.'
    )
  }
  if (managed.length > 1) {
    throw new Error(
      `More than one effective configuration is writable by this checkout (${managed.map((source) => source.label).join(', ')}). Run npx sim-setup config and remove the ambiguity before configuring a feature.`
    )
  }

  const source = managed[0]
  if (!source.values) {
    throw new Error(
      `${source.label} is managed by this checkout, but its effective environment could not be resolved. Run npx sim-setup config and fix the reported source error first.`
    )
  }
  if (source.kind === 'helm') {
    throw new Error(
      'Helm configuration cannot be updated by npx sim-setup add. Update the release Secret or values and upgrade the release.'
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
  let remove: readonly string[]
  const capabilitySetup = getCapabilitySetup(feature)

  if (capabilitySetup) {
    const result = await promptCapabilitySetup(capabilitySetup, vars, {
      containerized: destination.containerized,
    })
    values = result.values
    remove = result.remove
  } else if (feature === 'integration') {
    values = await setupIntegration(args[0], vars)
    remove = []
  } else if (feature === 'llm') {
    const result = await setupLlm(vars)
    values = result.values
    remove = result.remove
  } else {
    throw new Error(`Setup feature ${feature} has no handler`)
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
