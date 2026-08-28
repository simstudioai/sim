import { getEffectiveEnvironmentSnapshot } from '@/lib/environment/utils'
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
  workspaceId: string
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
    for (const field of manifest.context.sensitive ?? []) {
      input.protectedValues.add(context[field])
    }
    return { context, request: input.request, references: new Map() }
  }

  const snapshot = await getEffectiveEnvironmentSnapshot(input.requesterUserId, input.workspaceId)
  const references = new Map<string, ResolvedSelectorReference>()
  const visibleWorkspaceNames = new Set(snapshot.workspaceUnredactedKeys)

  const resolve = (field: string, value: string): string => {
    const match = EXACT_ENVIRONMENT_REFERENCE.exec(value)
    if (!match) return value

    const name = match[1]
    const fromWorkspace = Object.hasOwn(snapshot.workspaceDecrypted, name)
    const resolved = fromWorkspace
      ? snapshot.workspaceDecrypted[name]
      : snapshot.personalDecrypted[name]
    if (resolved === undefined) throw new SelectorContextUnavailableError()

    input.protectedValues.add(resolved)
    references.set(field, {
      field,
      name,
      scope: fromWorkspace ? 'workspace' : 'personal',
      visible: fromWorkspace
        ? visibleWorkspaceNames.has(name)
        : snapshot.personalOwners[name] === input.requesterUserId,
    })
    return resolved
  }

  const context: SelectorContext = {}
  for (const [field, value] of contextEntries) {
    context[field as keyof SelectorContext] = resolve(field, value)
  }

  for (const field of manifest.context.sensitive ?? []) {
    input.protectedValues.add(context[field])
  }

  const request =
    input.request.kind === 'detail'
      ? { ...input.request, id: resolve('request.id', input.request.id) }
      : input.request

  return { context, request, references }
}
