import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { findWorkspaceCredentialLookup } from '@/lib/credentials/queries'
import { getKnowledgeBaseNames } from '@/lib/knowledge/service'
import type { ExecutionContext } from '@/executor/types'
import {
  type BoundResourceKind,
  getToolPinnedFields,
  sanitizeStatedText,
  type ToolPinnedField,
} from '@/providers/tool-binding'
import type { ProviderToolConfig } from '@/providers/types'

const logger = createLogger('ToolPinnedParams')

/**
 * Bounds the appended sentence. Every stated field costs prompt tokens on every request in the
 * tool loop, for every tool, whether or not the model ever calls it — so this stays small.
 */
const MAX_STATED_FIELDS = 3

type ResourceNameResolver = (
  ids: readonly string[],
  workspaceId: string
) => Promise<Map<string, string>>

/**
 * Reuses `findWorkspaceCredentialLookup` per id rather than one batched `inArray`: that helper
 * encodes the workspace scope, the legacy `account.id`-second lookup and the `managed_oauth`
 * exclusion, all of which a batch query would have to re-derive. N is bounded by the tools on one
 * agent block and is resolved once per run, so the fan-out stays small.
 */
const resolveCredentialNames: ResourceNameResolver = async (ids, workspaceId) => {
  const names = new Map<string, string>()
  const rows = await Promise.all(
    ids.map((credentialId) => findWorkspaceCredentialLookup({ workspaceId, credentialId }))
  )
  ids.forEach((id, index) => {
    const displayName = rows[index]?.displayName
    if (displayName) names.set(id, displayName)
  })
  return names
}

const RESOLVERS: Record<BoundResourceKind, ResourceNameResolver> = {
  credential: resolveCredentialNames,
  knowledgeBase: (ids, workspaceId) => getKnowledgeBaseNames(ids, workspaceId),
}

function renderField(field: ToolPinnedField, resolved: ReadonlyMap<string, string>): string {
  if ('resource' in field) {
    const name = sanitizeStatedText(
      resolved.get(`${field.resource.kind}:${field.resource.id}`) ?? ''
    )
    return name ? `${field.title} "${name}"` : ''
  }
  return typeof field.value === 'string'
    ? `${field.title} "${field.value}"`
    : `${field.title} ${field.value}`
}

/**
 * Tells the model which values a workflow pinned on a tool, and — when the agent holds several
 * copies of that tool that differ — that it must pick the right one.
 *
 * Every pinned param is stripped from the schema the model sees (`createLLMToolSchema` drops any
 * param the user filled), so without this the model cannot tell that a Gmail tool reads only
 * `INBOX`, cannot distinguish it from a sibling reading `SENT`, and may promise a caller it will
 * search a folder it can never reach.
 *
 * Mutates `description` on the exact objects passed in. Provenance elsewhere is keyed on tool
 * identity, so no tool is ever replaced. Never throws: an unresolvable value is simply omitted.
 *
 * `withholdLiteralValues` marks a tool whose configured params resolved an environment secret.
 * Its literal values are suppressed; resolved resource names still state, since a looked-up name
 * cannot itself carry the secret.
 */
export async function annotateToolPinnedParams(
  ctx: Pick<ExecutionContext, 'workspaceId' | 'toolBindingLabelCache'>,
  tools: ProviderToolConfig[],
  withholdLiteralValues?: (tool: ProviderToolConfig) => boolean
): Promise<void> {
  const { workspaceId } = ctx
  if (!workspaceId) return

  const annotatable = tools
    .map((tool) => ({ tool, fields: getToolPinnedFields(tool) ?? [] }))
    .filter((entry) => entry.fields.length > 0)
  if (annotatable.length === 0) return

  const cache = ctx.toolBindingLabelCache ?? new Map<string, string | null>()
  const cacheKey = (kind: BoundResourceKind, id: string) => `${kind}:${id}`

  const pendingByKind = new Map<BoundResourceKind, Set<string>>()
  for (const { fields } of annotatable) {
    for (const field of fields) {
      if (!('resource' in field)) continue
      const { kind, id } = field.resource
      if (cache.has(cacheKey(kind, id))) continue
      const pending = pendingByKind.get(kind)
      if (pending) pending.add(id)
      else pendingByKind.set(kind, new Set([id]))
    }
  }

  await Promise.all(
    [...pendingByKind].map(async ([kind, ids]) => {
      const idList = [...ids]
      try {
        const resolved = await RESOLVERS[kind](idList, workspaceId)
        for (const id of idList) cache.set(cacheKey(kind, id), resolved.get(id) ?? null)
      } catch (error) {
        // Degrade to an unnamed resource rather than failing the agent block over a description.
        logger.warn('Failed to resolve pinned resource names', {
          kind,
          count: idList.length,
          error: getErrorMessage(error),
        })
        for (const id of idList) cache.set(cacheKey(kind, id), null)
      }
    })
  )

  const resolvedNames = new Map<string, string>()
  for (const [key, name] of cache) if (name) resolvedNames.set(key, name)

  const statements = new Map<ProviderToolConfig, string>()
  for (const { tool, fields } of annotatable) {
    const withhold = withholdLiteralValues?.(tool) ?? false
    const rendered: string[] = []
    for (const field of fields) {
      if (rendered.length === MAX_STATED_FIELDS) break
      if (withhold && !('resource' in field)) continue
      const text = renderField(field, resolvedNames)
      if (text) rendered.push(text)
    }
    if (rendered.length > 0) statements.set(tool, rendered.join(', '))
  }

  // Only claim the copies differ when their stated values actually do. Two tools bound to the same
  // account and folder render identically, and telling the model to "call the copy the request
  // refers to" would assert a distinction it cannot act on.
  const statementsByCanonicalId = new Map<string, Set<string>>()
  for (const tool of tools) {
    const statement = statements.get(tool)
    if (statement === undefined) continue
    const key = tool.canonicalId ?? tool.id
    const seen = statementsByCanonicalId.get(key)
    if (seen) seen.add(statement)
    else statementsByCanonicalId.set(key, new Set([statement]))
  }

  for (const [tool, statement] of statements) {
    const distinct = statementsByCanonicalId.get(tool.canonicalId ?? tool.id)?.size ?? 1
    const duplicateHint =
      distinct > 1
        ? ' Other copies of this tool on this agent are pinned to different values — call the copy the request refers to.'
        : ''
    tool.description = `${tool.description}\n\nPinned by the workflow and not changeable per call: ${statement}.${duplicateHint}`
  }
}
