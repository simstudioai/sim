import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { findWorkspaceCredentialLookup } from '@/lib/credentials/queries'
import { getKnowledgeBaseNames } from '@/lib/knowledge/service'
import type { ExecutionContext } from '@/executor/types'
import {
  type BoundResourceKind,
  getToolPinnedFields,
  groupDuplicateToolsByCanonicalId,
  sanitizeStatedText,
  type ToolPinnedField,
} from '@/providers/tool-binding'
import type { ProviderToolConfig } from '@/providers/types'

const logger = createLogger('ToolPinnedParams')

/** Bounds the appended sentence so a heavily configured tool cannot bury its own description. */
const MAX_STATED_FIELDS = 6

type BindingLabelResolver = (
  ids: readonly string[],
  workspaceId: string
) => Promise<Map<string, string>>

/**
 * Reuses `findWorkspaceCredentialLookup` per id rather than one batched `inArray`: that helper
 * already encodes the workspace scope, the legacy `account.id`-second lookup, and the
 * `managed_oauth` exclusion, none of which a fresh batch query would inherit. Ids are deduped
 * across the whole request and memoized for the run, so a credential reused by several tools
 * costs one read.
 */
const resolveCredentialLabels: BindingLabelResolver = async (ids, workspaceId) => {
  const labels = new Map<string, string>()
  const rows = await Promise.all(
    ids.map((credentialId) => findWorkspaceCredentialLookup({ workspaceId, credentialId }))
  )
  ids.forEach((id, index) => {
    const displayName = rows[index]?.displayName
    if (displayName) labels.set(id, displayName)
  })
  return labels
}

const resolveKnowledgeBaseLabels: BindingLabelResolver = (ids, workspaceId) =>
  getKnowledgeBaseNames(ids, workspaceId)

const RESOLVERS: Record<BoundResourceKind, BindingLabelResolver | undefined> = {
  credential: resolveCredentialLabels,
  knowledgeBase: resolveKnowledgeBaseLabels,
  // Resolved by `transformBlockTool`, which already fetches the workflow's metadata.
  workflow: undefined,
}

export interface ToolPinnedParamsOptions {
  /**
   * True for a tool whose configured params resolved an environment secret. Its literal values are
   * withheld — only looked-up resource names, which cannot themselves carry the secret, are stated.
   */
  hasResolvedSecretInputs?: (tool: ProviderToolConfig) => boolean
}

function renderField(field: ToolPinnedField, value: string, quoted: boolean): string {
  return quoted ? `${field.title} "${value}"` : `${field.title} ${value}`
}

/**
 * Tells the model which values a workflow pinned on a tool, and — when the agent holds several
 * copies of that tool — that the copies differ.
 *
 * Every pinned param is stripped from the schema the model sees (`createLLMToolSchema` drops any
 * param the user filled), so without this the model cannot tell that a Gmail tool reads only
 * `INBOX`, cannot distinguish it from a sibling reading `SENT`, and may promise a caller it will
 * search a folder it can never reach.
 *
 * Mutates `description` on the exact objects passed in. Provenance elsewhere is keyed on tool
 * identity, so no tool is ever replaced. Never throws: an unresolvable value is simply omitted.
 */
export async function annotateToolPinnedParams(
  ctx: Pick<ExecutionContext, 'workspaceId' | 'toolBindingLabelCache'>,
  tools: ProviderToolConfig[],
  options: ToolPinnedParamsOptions = {}
): Promise<void> {
  const { workspaceId } = ctx
  if (!workspaceId || tools.length === 0) return

  const annotatable = tools.filter((tool) => getToolPinnedFields(tool)?.length)
  if (annotatable.length === 0) return

  const cache = ctx.toolBindingLabelCache ?? new Map<string, string | null>()
  const cacheKey = (kind: BoundResourceKind, id: string) => `${kind}:${id}`

  const pendingByKind = new Map<BoundResourceKind, Set<string>>()
  for (const tool of annotatable) {
    for (const field of getToolPinnedFields(tool) ?? []) {
      const resource = field.resource
      if (!resource || !RESOLVERS[resource.kind]) continue
      if (cache.has(cacheKey(resource.kind, resource.id))) continue
      const pending = pendingByKind.get(resource.kind)
      if (pending) pending.add(resource.id)
      else pendingByKind.set(resource.kind, new Set([resource.id]))
    }
  }

  await Promise.all(
    [...pendingByKind].map(async ([kind, ids]) => {
      const idList = [...ids]
      const resolver = RESOLVERS[kind]
      if (!resolver) return
      try {
        const resolved = await resolver(idList, workspaceId)
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

  const groupSizeByTool = new Map<ProviderToolConfig, number>()
  for (const group of groupDuplicateToolsByCanonicalId(tools)) {
    for (const tool of group) groupSizeByTool.set(tool, group.length)
  }

  for (const tool of annotatable) {
    const withholdValues = options.hasResolvedSecretInputs?.(tool) ?? false
    const rendered: string[] = []

    for (const field of getToolPinnedFields(tool) ?? []) {
      if (rendered.length === MAX_STATED_FIELDS) break

      if (field.resource) {
        const name = cache.get(cacheKey(field.resource.kind, field.resource.id))
        const label = name ? sanitizeStatedText(name) : ''
        if (label) rendered.push(renderField(field, label, true))
        continue
      }

      if (withholdValues || !field.value) continue
      rendered.push(renderField(field, field.value, field.quoted ?? true))
    }

    if (rendered.length === 0) continue

    const groupSize = groupSizeByTool.get(tool)
    const duplicateHint = groupSize
      ? ` This agent has ${groupSize} copies of this tool with different pinned values — call the copy the request refers to.`
      : ''
    tool.description = `${tool.description}\n\nPinned by the workflow and not changeable per call: ${rendered.join(', ')}.${duplicateHint}`
  }
}
