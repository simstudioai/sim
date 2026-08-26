import { generateShortId } from '@sim/utils/id'
import { SELECTOR_CONTEXT_FIELDS } from '@/lib/workflows/subblocks/context'
import type { CanonicalIndex } from '@/lib/workflows/subblocks/visibility'
import { extractEnvVarName, isEnvVarReference, isReference } from '@/executor/constants'
import type { SelectorContext, SelectorDefinition } from '@/hooks/selectors/types'

interface PersonalEnvironmentValue {
  value?: string
}

export interface SelectorCacheScopeRegistry {
  getScope(definition: SelectorDefinition, context: SelectorContext): string | undefined
}

/**
 * Keeps raw dependency identity private while assigning stable opaque cache revisions.
 *
 * The raw signature exists only inside this component-lifetime registry. It is never returned,
 * hashed into a key, or exposed to React Query. Repeated contexts reuse a revision; changing any
 * server-resolved dependency receives a new one.
 */
export function createSelectorCacheScopeRegistry(
  createScope: () => string = generateShortId
): SelectorCacheScopeRegistry {
  const scopes = new Map<string, string>()

  return {
    getScope(definition, context) {
      const fields = definition.serverResolvedContextFields
      if (!fields?.length) return undefined

      const privateIdentity = JSON.stringify([
        definition.key,
        ...fields.map((field) => [field, context[field] ?? null]),
      ])
      const existing = scopes.get(privateIdentity)
      if (existing) return existing

      const scope = createScope()
      scopes.set(privateIdentity, scope)
      return scope
    },
  }
}

/** Adds an opaque revision only to selectors that opt into server-resolved context. */
export function scopeServerResolvedSelectorContext(
  definition: SelectorDefinition,
  context: SelectorContext,
  registry: SelectorCacheScopeRegistry
): SelectorContext {
  const selectorCacheScope = registry.getScope(definition, context)
  return selectorCacheScope ? { ...context, selectorCacheScope } : context
}

/** Preserves opted-in environment references and keeps legacy personal resolution elsewhere. */
export function resolveSelectorDependencyValues(input: {
  dependencyValues: Record<string, unknown>
  personalEnvironment: Record<string, PersonalEnvironmentValue>
  canonicalIndex: CanonicalIndex
  serverResolvedContextFields: ReadonlySet<keyof SelectorContext>
}): Record<string, unknown> {
  const resolved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input.dependencyValues)) {
    if (value === null || value === undefined) {
      resolved[key] = value
      continue
    }

    const stringValue = String(value)
    if (!isEnvVarReference(stringValue)) {
      resolved[key] = value
      continue
    }

    const canonicalParamId = input.canonicalIndex.canonicalIdBySubBlockId[key] ?? key
    if (input.serverResolvedContextFields.has(canonicalParamId as keyof SelectorContext)) {
      resolved[key] = stringValue
      continue
    }

    const variableName = extractEnvVarName(stringValue)
    resolved[key] = input.personalEnvironment[variableName]?.value || undefined
  }
  return resolved
}

/** Adds eligible dependencies to selector context while excluding runtime block references. */
export function applySelectorDependenciesToContext(input: {
  context: SelectorContext
  dependencyValues: Record<string, unknown>
  canonicalIndex: CanonicalIndex
}): SelectorContext {
  for (const [dependencyKey, value] of Object.entries(input.dependencyValues)) {
    if (value === null || value === undefined) continue
    const stringValue = String(value)
    if (!stringValue || isReference(stringValue)) continue

    const canonicalParamId =
      input.canonicalIndex.canonicalIdBySubBlockId[dependencyKey] ?? dependencyKey
    if (SELECTOR_CONTEXT_FIELDS.has(canonicalParamId as keyof SelectorContext)) {
      input.context[canonicalParamId as keyof SelectorContext] = stringValue
    }
  }
  return input.context
}
