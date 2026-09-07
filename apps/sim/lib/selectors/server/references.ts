import { resolveEffectiveEnvironmentVariables } from '@/lib/environment/utils'
import { getSelectorManifestEntry, type ServerSelectorKey } from '@/lib/selectors/manifest'
import { SelectorContextUnavailableError } from '@/lib/selectors/server/errors'
import type {
  ResolvedSelectorReference,
  SelectorProtectedValues,
} from '@/lib/selectors/server/types'
import type { SelectorContext, SelectorRequest } from '@/lib/selectors/types'

const EXACT_ENVIRONMENT_REFERENCE = /^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/

export interface ResolvedSelectorInputs {
  context: SelectorContext
  request: SelectorRequest
  references: ReadonlyMap<string, ResolvedSelectorReference>
}

function rejectsEmbeddedReference(value: string): boolean {
  return (value.includes('{{') || value.includes('}}')) && !EXACT_ENVIRONMENT_REFERENCE.test(value)
}

function containsRuntimeReference(value: string): boolean {
  return /<[^<>]+>/.test(value)
}

export async function resolveSelectorReferences(input: {
  selectorKey: ServerSelectorKey
  context: SelectorContext
  request: SelectorRequest
  requesterUserId: string
  workspaceId?: string
  protectedValues: SelectorProtectedValues
}): Promise<ResolvedSelectorInputs> {
  const contextEntries = Object.entries(input.context).filter(
    (entry): entry is [string, string] => entry[1] !== undefined
  )
  const resolvableValues = [
    ...contextEntries.map(([, value]) => value),
    ...(input.request.kind === 'detail' ? [input.request.id] : []),
  ]
  if (
    resolvableValues.some(
      (value) => rejectsEmbeddedReference(value) || containsRuntimeReference(value)
    )
  ) {
    throw new SelectorContextUnavailableError()
  }

  const manifest = getSelectorManifestEntry(input.selectorKey)
  if (!resolvableValues.some((value) => EXACT_ENVIRONMENT_REFERENCE.test(value))) {
    const context = Object.fromEntries(contextEntries) as SelectorContext
    return { context, request: input.request, references: new Map() }
  }

  if (!input.workspaceId) throw new SelectorContextUnavailableError()

  const sensitiveFields = new Set<string>(manifest.context.sensitive ?? [])

  const referenceNames = [
    ...new Set(
      resolvableValues.flatMap((value) => {
        const match = EXACT_ENVIRONMENT_REFERENCE.exec(value)
        return match ? [match[1]] : []
      })
    ),
  ]
  const resolvedVariables = await resolveEffectiveEnvironmentVariables(
    input.requesterUserId,
    input.workspaceId,
    referenceNames
  )
  const references = new Map<string, ResolvedSelectorReference>()

  const resolve = (field: string, value: string): string => {
    const match = EXACT_ENVIRONMENT_REFERENCE.exec(value)
    if (!match) return value

    const name = match[1]
    const variable = Object.hasOwn(resolvedVariables, name) ? resolvedVariables[name] : undefined
    if (!variable) throw new SelectorContextUnavailableError()

    if (!variable.visible) {
      input.protectedValues.add(variable.value, sensitiveFields.has(field) ? 'secret' : 'reference')
    }
    references.set(field, {
      field,
      name,
      scope: variable.scope,
      visible: variable.visible,
    })
    return variable.value
  }

  const context: SelectorContext = {}
  for (const [field, value] of contextEntries) {
    context[field as keyof SelectorContext] = resolve(field, value)
  }

  const request =
    input.request.kind === 'detail'
      ? { ...input.request, id: resolve('request.id', input.request.id) }
      : input.request

  return { context, request, references }
}
