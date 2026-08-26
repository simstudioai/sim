import { SELECTOR_CONTEXT_FIELDS } from '@/lib/workflows/subblocks/context'
import type { CanonicalIndex } from '@/lib/workflows/subblocks/visibility'
import { extractEnvVarName, isEnvVarReference, isReference } from '@/executor/constants'
import type { SelectorContext } from '@/hooks/selectors/types'

interface PersonalEnvironmentValue {
  value?: string
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
